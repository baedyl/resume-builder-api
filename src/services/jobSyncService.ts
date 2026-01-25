import axios from 'axios';
import { prisma } from '../lib/database';

export interface JobSourceConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  searchEndpoint: string;
  headers?: Record<string, string>;
}

export class JobSyncService {
  private static readonly JOB_SOURCES: JobSourceConfig[] = [
    {
      name: 'jsearch',
      apiKey: process.env.JSEARCH_API_KEY || '',
      baseUrl: 'https://jsearch.p.rapidapi.com',
      searchEndpoint: '/search',
      headers: {
        'X-RapidAPI-Key': process.env.JSEARCH_API_KEY || '',
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      }
    }
    // Add more sources as needed:
    // {
    //   name: 'adzuna',
    //   apiKey: process.env.ADZUNA_API_KEY || '',
    //   baseUrl: 'https://api.adzuna.com/v1/api/jobs',
    //   searchEndpoint: '/us/search/1'
    // }
  ];

  static async syncJobsFromAllSources(): Promise<{ successCount: number; failureCount: number }> {
    console.log('Starting job sync from all sources...');

    const results = await Promise.allSettled(
      this.JOB_SOURCES.map(source => this.syncJobsFromSource(source))
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.filter(r => r.status === 'rejected').length;

    console.log(`Job sync completed: ${successCount} successful, ${failureCount} failed`);

    return { successCount, failureCount };
  }

  static async syncJobsFromSource(sourceConfig: JobSourceConfig): Promise<number> {
    try {
      console.log(`Syncing jobs from ${sourceConfig.name}...`);

      const jobs = await this.fetchJobsFromAPI(sourceConfig);
      const processedJobs = await this.processAndSaveJobs(jobs, sourceConfig.name);

      // Update last sync time
      await prisma.jobSource.upsert({
        where: { name: sourceConfig.name },
        update: { lastSync: new Date() },
        create: {
          name: sourceConfig.name,
          displayName: this.getDisplayName(sourceConfig.name),
          baseUrl: sourceConfig.baseUrl,
          apiKey: sourceConfig.apiKey ? '***' : null, // Don't store actual API key
          lastSync: new Date()
        }
      });

      console.log(`Synced ${processedJobs} jobs from ${sourceConfig.name}`);
      return processedJobs;
    } catch (error) {
      console.error(`Error syncing from ${sourceConfig.name}:`, error);
      throw error;
    }
  }

  private static async fetchJobsFromAPI(sourceConfig: JobSourceConfig): Promise<any[]> {
    const response = await axios.get(`${sourceConfig.baseUrl}${sourceConfig.searchEndpoint}`, {
      headers: sourceConfig.headers,
      params: {
        query: 'developer OR engineer OR designer OR analyst OR manager OR sales OR marketing OR finance OR healthcare OR admin OR "customer service" OR "human resources"', // Broad search across multiple sectors
        page: 1,
        num_pages: 10, // Fetch more pages
        country: 'US',
        date_posted: 'week' // Only recent jobs
      },
      timeout: 30000 // 30 second timeout
    });

    return response.data.data || response.data.jobs || [];
  }

  private static async processAndSaveJobs(jobs: any[], source: string): Promise<number> {
    let processedCount = 0;

    for (const jobData of jobs) {
      try {
        const job = this.normalizeJobData(jobData, source);

        // Skip invalid jobs
        if (!job.title || !job.company || !job.description) {
          continue;
        }

        // Check if job already exists
        const existingJob = await prisma.jobOpportunity.findUnique({
          where: {
            source_sourceId: {
              source: job.source,
              sourceId: job.sourceId
            }
          }
        });

        if (existingJob) {
          // Update existing job if it's changed significantly
          if (this.hasJobChanged(existingJob, job)) {
            await prisma.jobOpportunity.update({
              where: { id: existingJob.id },
              data: { ...job, lastSynced: new Date() }
            });
          }
        } else {
          // Create new job
          await prisma.jobOpportunity.create({ data: job });
          processedCount++;
        }
      } catch (error) {
        console.error(`Error processing job from ${source}:`, error);
      }
    }

    return processedCount;
  }

  private static normalizeJobData(jobData: any, source: string): any {
    // Normalize different API response formats to our schema
    const normalized = {
      title: this.cleanText(jobData.job_title || jobData.title || ''),
      company: this.cleanText(jobData.employer_name || jobData.company_name || jobData.company || ''),
      companyLogo: jobData.employer_logo || jobData.company_logo,
      description: this.cleanText(jobData.job_description || jobData.description || ''),
      requirements: this.extractRequirements(jobData),
      location: this.formatLocation(jobData),
      locationType: this.determineLocationType(jobData),
      salaryMin: jobData.job_min_salary ? parseFloat(jobData.job_min_salary) : null,
      salaryMax: jobData.job_max_salary ? parseFloat(jobData.job_max_salary) : null,
      currency: jobData.salary_currency || 'USD',
      jobType: this.normalizeJobType(jobData.job_employment_type || jobData.employment_type),
      experienceLevel: this.determineExperienceLevel(jobData),
      applicationUrl: jobData.job_apply_link || jobData.apply_url || jobData.url,
      source,
      sourceId: String(jobData.job_id || jobData.id || ''),
      sourceUrl: jobData.job_apply_link || jobData.url || '',
      postedDate: jobData.job_posted_at_datetime_utc
        ? new Date(jobData.job_posted_at_datetime_utc)
        : jobData.posted_date ? new Date(jobData.posted_date) : new Date(),
      lastSynced: new Date(),
      isActive: true
    };

    return normalized;
  }

  private static cleanText(text: string): string {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  private static extractRequirements(jobData: any): string | null {
    // Try to extract requirements from description or separate field
    const description = jobData.job_description || jobData.description || '';
    const requirements = jobData.job_required_skills || jobData.requirements;

    if (requirements) return this.cleanText(requirements);

    // Look for requirements section in description
    const requirementsMatch = description.match(/(?:requirements|qualifications|what you need|you have)(.*?)(?:responsibilities|what you'll do|benefits|$)/is);
    if (requirementsMatch) {
      return this.cleanText(requirementsMatch[1]);
    }

    return null;
  }

  private static formatLocation(jobData: any): string {
    const city = jobData.job_city || jobData.city;
    const state = jobData.job_state || jobData.state;
    const country = jobData.job_country || jobData.country;

    const parts = [city, state, country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'Remote';
  }

  private static determineLocationType(jobData: any): string | null {
    const description = (jobData.job_description || jobData.description || '').toLowerCase();
    const location = (jobData.job_city || jobData.city || '').toLowerCase();

    if (description.includes('remote') || location.includes('remote')) return 'remote';
    if (description.includes('hybrid')) return 'hybrid';
    if (location && location !== 'remote') return 'onsite';
    return null;
  }

  private static normalizeJobType(jobType: string): string | null {
    if (!jobType) return null;

    const type = jobType.toLowerCase();
    if (type.includes('full') || type.includes('permanent')) return 'full-time';
    if (type.includes('part')) return 'part-time';
    if (type.includes('contract') || type.includes('freelance') || type.includes('temporary')) return 'contract';
    if (type.includes('intern')) return 'internship';

    return null;
  }

  private static determineExperienceLevel(jobData: any): string | null {
    const title = (jobData.job_title || jobData.title || '').toLowerCase();
    const description = (jobData.job_description || jobData.description || '').toLowerCase();

    const levelIndicators = {
      entry: ['entry', 'junior', 'graduate', '0-2', '0-3', 'fresh', 'new grad'],
      mid: ['mid', 'intermediate', '3-5', '2-5', '3+', '2+'],
      senior: ['senior', 'lead', 'principal', '5+', '7+', 'sr ', 'sr.'],
      executive: ['director', 'vp', 'head', 'chief', 'executive', 'manager']
    };

    for (const [level, keywords] of Object.entries(levelIndicators)) {
      if (keywords.some(keyword => title.includes(keyword) || description.includes(keyword))) {
        return level;
      }
    }

    return null;
  }

  private static hasJobChanged(existing: any, updated: any): boolean {
    const fieldsToCheck = ['title', 'company', 'description', 'location', 'salaryMin', 'salaryMax'];
    const importantFieldsToCheck = ['applicationUrl', 'isActive'];

    // Check if important fields changed
    for (const field of importantFieldsToCheck) {
      if (existing[field] !== updated[field]) return true;
    }

    // Check if significant content changed
    for (const field of fieldsToCheck) {
      if (existing[field] !== updated[field]) return true;
    }

    return false;
  }

  private static getDisplayName(source: string): string {
    const displayNames: Record<string, string> = {
      'jsearch': 'JSearch API',
      'indeed': 'Indeed',
      'linkedin': 'LinkedIn',
      'glassdoor': 'Glassdoor',
      'adzuna': 'Adzuna'
    };

    return displayNames[source] || source;
  }

  // Clean up old inactive jobs
  static async cleanupInactiveJobs(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await prisma.jobOpportunity.updateMany({
      where: {
        lastSynced: {
          lt: cutoffDate
        },
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    console.log(`Marked ${result.count} old jobs as inactive`);
    return result.count;
  }
}
