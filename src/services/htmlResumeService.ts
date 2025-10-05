import { readFileSync } from 'fs';
import { join } from 'path';
import Mustache from 'mustache';
import { getLanguageConfig, localizeLanguageName, localizeProficiency } from '../utils/language';

export interface ResumeData {
  fullName: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  linkedIn?: string | null;
  website?: string | null;
  summary?: string | null;
  workExperience: Array<{
    jobTitle: string;
    company: string;
    location?: string;
    startDate: string;
    endDate?: string;
    description?: string;
    companyDescription?: string;
    techStack?: string;
  }>;
  education: Array<{
    degree: string;
    institution: string;
    startYear?: number;
    graduationYear?: number;
    description?: string;
  }>;
  skills: Array<{ name: string }>;
  languages: Array<{ name: string; proficiency: string }>;
  certifications?: Array<{ name: string; issuer?: string; issueDate?: string | Date }>;
}

function getTemplate(templateName: string): string {
  const templatePath = join(__dirname, '..', 'templates', 'html', `${templateName}.html`);
  return readFileSync(templatePath, 'utf-8');
}

function processLanguageProficiency(language: { name: string; proficiency: string }) {
  const proficiencyLevels: Record<string, number> = {
    'Beginner': 1,
    'Elementary': 2,
    'Intermediate': 3,
    'Advanced': 4,
    'Native': 5,
    'Fluent': 4
  };
  
  const level = proficiencyLevels[language.proficiency] || 3;
  const circles = [];
  
  for (let i = 0; i < 5; i++) {
    circles.push({
      filled: i < level
    });
  }
  
  return {
    ...language,
    proficiencyLevels: circles
  };
}

function formatDate(date: string | Date): string {
  if (!date) return '';
  
  // Handle "Present" case for current jobs
  if (typeof date === 'string' && date.toLowerCase() === 'present') {
    return 'Present';
  }
  
  const d = new Date(date);
  
  // Check if the date is valid
  if (isNaN(d.getTime())) {
    return 'Present'; // Fallback for invalid dates
  }
  
  // Use UTC to avoid timezone shifting dates into previous year
  return d.getUTCFullYear().toString();
}

export function generateHTMLResume(data: ResumeData, templateName: string = 'colorful', language: string = 'en'): string {
  const template = getTemplate(templateName);
  const languageConfig = getLanguageConfig(language);
  
  // Process data for template
  const processedData = {
    ...data,
    titles: languageConfig.sections,
    labels: languageConfig.labels || { tech: 'Tech' },
    showCertifications: Array.isArray(data.certifications) && data.certifications.length > 0,
    headline: (data as any).title || (data as any).profession || (data as any).role || (data.workExperience && data.workExperience[0] && data.workExperience[0].jobTitle) || undefined,
    languagesLine: (data.languages || [])
      .map(l => `${l.name}: ${l.proficiency}`)
      .join(', '),
    skillsLine: (data.skills || [])
      .map(s => s.name)
      .join(', '),
    workExperience: data.workExperience.map(exp => ({
      ...exp,
      startDate: formatDate(exp.startDate),
      endDate: exp.endDate && exp.endDate !== 'Present' ? formatDate(exp.endDate) : 'Present',
      tasks: (() => {
        const companyDesc = String(exp.companyDescription || '').trim();
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const base = String(exp.description || '');
        const raw = companyDesc
          ? base.replace(new RegExp(escapeRegex(companyDesc), 'ig'), '').trim()
          : base;
        const parts = raw.includes('•') ? raw.split('•') : raw.split('.');
        const cleaned = parts
          .map(part => part.replace(/^\s*[•\-]\s*/g, '').trim())
          .filter(Boolean);
        // Remove duplicates and any task that equals the company description
        const seen = new Set<string>();
        const companyDescNorm = companyDesc.toLowerCase();
        return cleaned.filter(item => {
          const normalized = item.replace(/[\.;\s]+$/g, '').toLowerCase();
          if (companyDescNorm && normalized === companyDescNorm) return false;
          if (seen.has(normalized)) return false;
          seen.add(normalized);
          return true;
        });
      })()
    })),
    education: data.education.map(edu => ({
      ...edu,
      startYear: edu.startYear,
      graduationYear: edu.graduationYear?.toString()
    })),
    languages: data.languages.map(l => {
      const name = localizeLanguageName(l.name, language);
      const proficiency = localizeProficiency(l.proficiency, language);
      const processed = processLanguageProficiency({ name, proficiency });
      return {
        name,
        proficiency,
        proficiencyLevels: processed.proficiencyLevels
      };
    }),
    certifications: (data.certifications || []).map(cert => ({
      ...cert,
      issueDate: cert.issueDate ? formatDate(cert.issueDate) : undefined
    }))
  };
  
  return Mustache.render(template, processedData);
} 