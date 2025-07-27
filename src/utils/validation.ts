import { z } from 'zod';

// Common schemas used across multiple routes
export const WorkExperienceSchema = z.object({
    jobTitle: z.string().min(1, 'Job title is required'),
    company: z.string().min(1, 'Company is required'),
    location: z.string().optional(),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().optional(),
    isCurrent: z.boolean().optional(),
    description: z.string().optional(),
});

export const EducationSchema = z.object({
    degree: z.string().min(1, 'Degree is required'),
    major: z.string().optional(),
    institution: z.string().min(1, 'Institution is required'),
    graduationYear: z.number().int().min(1900, 'Graduation year must be a valid year').max(9999, 'Graduation year must be a valid year').optional(),
    gpa: z.number().optional(),
    description: z.string().optional(),
});

export const SkillSchema = z.object({
    id: z.number().optional(),
    name: z.string().min(1, 'Skill name is required'),
});

export const LanguageSchema = z.object({
    name: z.string().min(1, 'Language name is required'),
    proficiency: z.string().min(1, 'Proficiency is required'),
});

export const CertificationSchema = z.object({
    name: z.string().min(1, 'Certification name is required'),
    issuer: z.string().min(1, 'Issuer is required'),
    issueDate: z.string().optional(),
});

// Contact info schema - used in multiple places
export const ContactInfoSchema = z.object({
    fullName: z.string().optional(),
    email: z.string().email('Invalid email').optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
});

// Date parsing utility schema
export const DateTimeSchema = z.string().datetime().optional(); 