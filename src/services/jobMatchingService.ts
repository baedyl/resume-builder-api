import { prisma } from '../lib/database';

export interface MatchResult {
  job: any;
  matchScore: number;
  matchedSkills: string[];
  matchReasons: string[];
}

export class JobMatchingService {
  static async findMatchingJobs(userId: string, limit: number = 20): Promise<MatchResult[]> {
    // Get user's latest resume with all details
    const userResume = await prisma.resume.findFirst({
      where: { userId },
      include: {
        skills: true,
        workExperiences: true,
        languages: true,
        educations: true
      },
      orderBy: { updatedAt: 'desc' }
    });

    if (!userResume) return [];

    // Get active job opportunities
    const jobOpportunities = await prisma.jobOpportunity.findMany({
      where: { isActive: true },
      include: {
        skills: {
          include: { skill: true }
        }
      },
      take: limit * 2 // Get more to allow for filtering
    });

    // Calculate match scores for each job
    const matches: MatchResult[] = jobOpportunities.map(job => ({
      job,
      matchScore: this.calculateMatchScore(userResume, job),
      matchedSkills: this.getMatchedSkills(userResume, job),
      matchReasons: this.getMatchReasons(userResume, job)
    }));

    // Sort by match score and return top results
    return matches
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);
  }

  static async findJobsBySkills(skillIds: number[], limit: number = 20): Promise<any[]> {
    return await prisma.jobOpportunity.findMany({
      where: {
        isActive: true,
        skills: {
          some: {
            skillId: { in: skillIds }
          }
        }
      },
      include: {
        skills: {
          include: { skill: true }
        },
        _count: {
          select: { applications: true }
        }
      },
      take: limit,
      orderBy: { createdAt: 'desc' }
    });
  }

  private static calculateMatchScore(resume: any, job: any): number {
    let score = 0;
    let maxScore = 100;
    const reasons: string[] = [];

    // Skill matching (40% weight)
    const userSkillIds = resume.skills.map((s: any) => s.skillId);
    const requiredSkillIds = job.skills.filter((s: any) => s.isRequired).map((s: any) => s.skillId);
    const preferredSkillIds = job.skills.filter((s: any) => !s.isRequired).map((s: any) => s.skillId);

    const requiredMatches = requiredSkillIds.filter((id: number) => userSkillIds.includes(id)).length;
    const preferredMatches = preferredSkillIds.filter((id: number) => userSkillIds.includes(id)).length;

    const requiredScore = requiredSkillIds.length > 0 ? (requiredMatches / requiredSkillIds.length) * 30 : 0;
    const preferredScore = preferredSkillIds.length > 0 ? (preferredMatches / preferredSkillIds.length) * 10 : 0;

    score += requiredScore + preferredScore;

    if (requiredMatches > 0) reasons.push(`Matches ${requiredMatches} required skills`);
    if (preferredMatches > 0) reasons.push(`Matches ${preferredMatches} preferred skills`);

    // Experience level matching (25% weight)
    const experienceScore = this.calculateExperienceScore(resume.workExperiences, job.experienceLevel);
    score += experienceScore * 25;
    if (experienceScore > 0.7) reasons.push('Experience level matches');

    // Location preference (15% weight) - could be expanded with user preferences
    const locationScore = this.calculateLocationScore(resume, job);
    score += locationScore * 15;
    if (locationScore > 0.8) reasons.push('Location compatible');

    // Title/Keyword matching (10% weight)
    const keywordScore = this.calculateKeywordScore(resume, job);
    score += keywordScore * 10;
    if (keywordScore > 0.6) reasons.push('Title/keywords match');

    // Salary compatibility (10% weight) - if user has salary expectations
    const salaryScore = this.calculateSalaryScore(resume, job);
    score += salaryScore * 10;
    if (salaryScore > 0.8) reasons.push('Salary range compatible');

    return Math.min(Math.max(score, 0), maxScore);
  }

  private static calculateExperienceScore(workExperiences: any[], experienceLevel: string | null): number {
    if (!experienceLevel || !workExperiences.length) return 0.5; // Neutral score

    // Calculate total years of experience
    const totalYears = workExperiences.reduce((total, exp) => {
      const startDate = new Date(exp.startDate);
      const endDate = exp.endDate ? new Date(exp.endDate) : new Date();
      const years = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
      return total + years;
    }, 0);

    const levelScores = {
      entry: totalYears <= 2 ? 1 : totalYears <= 5 ? 0.7 : 0.3,
      mid: totalYears >= 2 && totalYears <= 7 ? 1 : totalYears >= 1 && totalYears <= 10 ? 0.8 : 0.4,
      senior: totalYears >= 5 ? 1 : totalYears >= 3 ? 0.8 : 0.3,
      executive: totalYears >= 8 ? 1 : totalYears >= 5 ? 0.7 : 0.2
    };

    return levelScores[experienceLevel as keyof typeof levelScores] || 0.5;
  }

  private static calculateLocationScore(resume: any, job: any): number {
    // For now, give higher score to remote jobs or if location is not specified
    if (!job.location || job.location.toLowerCase().includes('remote')) return 1;
    if (job.locationType === 'remote') return 1;

    // Could be enhanced with user's preferred locations
    return 0.7;
  }

  private static calculateKeywordScore(resume: any, job: any): number {
    const resumeText = this.buildResumeText(resume);
    const jobText = (job.title + ' ' + job.description).toLowerCase();

    // Extract keywords from job title and description
    const jobKeywords = this.extractKeywords(jobText);
    const resumeKeywords = this.extractKeywords(resumeText);

    const matches = jobKeywords.filter(keyword =>
      resumeKeywords.some(resumeKeyword => resumeKeyword.includes(keyword) || keyword.includes(resumeKeyword))
    );

    return jobKeywords.length > 0 ? matches.length / jobKeywords.length : 0;
  }

  private static calculateSalaryScore(resume: any, job: any): number {
    // This would ideally come from user preferences
    // For now, return neutral score
    return 0.5;
  }

  private static getMatchedSkills(resume: any, job: any): string[] {
    const userSkillIds = resume.skills.map((s: any) => s.skillId);
    const jobSkillIds = job.skills.map((s: any) => s.skillId);

    return resume.skills
      .filter((userSkill: any) => jobSkillIds.includes(userSkill.skillId))
      .map((userSkill: any) => userSkill.skill.name);
  }

  private static getMatchReasons(resume: any, job: any): string[] {
    const reasons: string[] = [];
    const matchedSkills = this.getMatchedSkills(resume, job);

    if (matchedSkills.length > 0) {
      reasons.push(`Skills: ${matchedSkills.slice(0, 3).join(', ')}${matchedSkills.length > 3 ? '...' : ''}`);
    }

    if (job.experienceLevel) {
      reasons.push(`Level: ${job.experienceLevel}`);
    }

    if (job.locationType === 'remote') {
      reasons.push('Remote work');
    }

    return reasons;
  }

  private static buildResumeText(resume: any): string {
    let text = '';

    // Add work experience titles and descriptions
    resume.workExperiences.forEach((exp: any) => {
      text += `${exp.jobTitle} ${exp.description || ''} `;
    });

    // Add skills
    resume.skills.forEach((skill: any) => {
      text += `${skill.skill.name} `;
    });

    // Add education
    resume.educations.forEach((edu: any) => {
      text += `${edu.degree} ${edu.major || ''} `;
    });

    return text.toLowerCase();
  }

  private static extractKeywords(text: string): string[] {
    // Simple keyword extraction - split by common delimiters and filter
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !this.isStopWord(word));

    // Return unique keywords
    return [...new Set(words)];
  }

  private static isStopWord(word: string): boolean {
    const stopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'an', 'a', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'];
    return stopWords.includes(word);
  }
}
