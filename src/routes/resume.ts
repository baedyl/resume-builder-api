import express from 'express';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import OpenAI from 'openai';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const prisma = new PrismaClient();
const router = express.Router();

// Initialize OpenRouter API client
const openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
});

// Zod schemas
const WorkExperienceSchema = z.object({
    jobTitle: z.string().min(1, 'Job title is required'),
    company: z.string().min(1, 'Company is required'),
    location: z.string().optional(),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().optional(),
    description: z.string().optional(),
});

const EducationSchema = z.object({
    degree: z.string().min(1, 'Degree is required'),
    major: z.string().optional(),
    institution: z.string().min(1, 'Institution is required'),
    graduationYear: z.number().int().min(1900, 'Graduation year must be a valid year').max(9999, 'Graduation year must be a valid year').optional(),
    gpa: z.number().optional(),
    description: z.string().optional(),
});

const SkillSchema = z.object({
    id: z.number(),
    name: z.string().min(1, 'Skill name is required'),
});

const LanguageSchema = z.object({
    name: z.string().min(1, 'Language name is required'),
    proficiency: z.string().min(1, 'Proficiency is required'),
});

const CertificationSchema = z.object({
    name: z.string().min(1, 'Certification name is required'),
    issuer: z.string().min(1, 'Issuer is required'),
    issueDate: z.string().optional(),
});

const ResumeSchema = z.object({
    id: z.string().optional(),
    fullName: z.string().min(1, 'Full name is required'),
    email: z.string().email('Invalid email'),
    phone: z.string().optional(),
    address: z.string().optional(),
    linkedIn: z.string().optional(),
    website: z.string().optional(),
    summary: z.string().optional(),
    skills: z.array(SkillSchema).default([]),
    workExperience: z.array(WorkExperienceSchema).min(1, 'At least one work experience is required'),
    education: z.array(EducationSchema).min(1, 'At least one education entry is required'),
    languages: z.array(LanguageSchema).default([]),
    certifications: z.array(CertificationSchema).default([]),
});

const EnhanceDescriptionSchema = z.object({
    jobTitle: z.string().min(1, 'Job title is required'),
    description: z.string().min(1, 'Description is required'),
});

const EnhanceSummarySchema = z.object({
    summary: z.string().min(1, 'Summary is required'),
});

let genericDescription = "";

// Fallback enhancement function
const generateFallbackEnhancement = (jobTitle: string, description: string): string => {
    const defaultBullets = [
        `• Performed core responsibilities as a ${jobTitle}, enhancing team productivity and project outcomes.`,
        `• Collaborated with stakeholders to achieve organizational goals, leveraging skills from prior experience.`,
        `• Contributed to key initiatives, adapting to dynamic work environments.`,
    ];
    genericDescription = description;
    return defaultBullets.join('\n');
};

router.post('/enhance-summary', asyncHandler(async (req: any, res) => {
    try {
        // Parse and validate the request body
        const { summary } = EnhanceSummarySchema.parse(req.body);

        // Define the prompt for OpenRouter API
        const prompt = `
You are an expert resume writer. Enhance the following professional summary to make it concise, impactful, and professional. Use strong language to highlight key strengths, experience, and career goals. Ensure the summary is ATS-friendly and suitable for a variety of roles. Return only the enhanced summary as a single paragraph.

Input summary: ${summary}
        `;

        // Initialize variable to store enhanced summary
        let enhancedSummary = '';
        const maxRetries = 2;

        // Retry logic for API call
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await openrouter.chat.completions.create({
                    model: 'deepseek/deepseek-r1',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.7 + (attempt - 1) * 0.1, // Increase creativity on retries
                    max_tokens: 500 + (attempt - 1) * 100, // Increase token limit on retries
                });

                console.log(`OpenRouter response (attempt ${attempt}):`, JSON.stringify(response, null, 2));

                const content = response.choices[0]?.message?.content?.trim();
                if (content && content.length > 0) {
                    enhancedSummary = content;
                    break;
                }
                console.warn(`Empty or invalid response on attempt ${attempt}`);
            } catch (apiError) {
                console.error(`API error on attempt ${attempt}:`, apiError);
                if (attempt === maxRetries) {
                    throw apiError; // Rethrow on final attempt
                }
            }
        }

        // Use fallback if enhancement fails
        if (!enhancedSummary) {
            console.warn('Using fallback summary due to empty API response');
            enhancedSummary = "A dedicated and versatile professional with a strong foundation in their field. Proven track record of delivering results and adapting to new challenges. Committed to continuous learning and professional growth.";
        }

        // Return the enhanced summary
        return res.json({ enhancedSummary });
    } catch (error) {
        console.error('Error in enhance-summary endpoint:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to enhance summary' });
    }
}));

// POST /api/resumes/enhance-description
router.post('/enhance-description', asyncHandler(async (req: any, res) => {
    try {
        const { jobTitle, description } = EnhanceDescriptionSchema.parse(req.body);

        const prompt = `
      You are an expert resume writer. Enhance the following job description for a ${jobTitle} role to make it professional, ATS-friendly, and impactful. Use strong action verbs, include quantifiable metrics where appropriate, and incorporate relevant keywords for the role. Format the output as bullet points starting with "• ". Each bullet should be concise and highlight key responsibilities or achievements. If the input is brief, expand it logically based on typical duties for the role. Return only the bullet-pointed (min 3 & max 4) text, no additional commentary.

      Input description: ${description}
    `;

        // Try API call with retries
        let enhancedDescription = '';
        const maxRetries = 2;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await openrouter.chat.completions.create({
                    model: 'deepseek/deepseek-r1',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.7 + (attempt - 1) * 0.1, // Slightly increase creativity on retries
                    max_tokens: 500 + (attempt - 1) * 100, // Increase token limit on retries
                });

                console.log(`OpenRouter response (attempt ${attempt}):`, JSON.stringify(response, null, 2));

                const content = response.choices[0]?.message?.content?.trim();
                if (content && content.includes('•')) {
                    enhancedDescription = content;
                    break;
                }
                console.warn(`Empty or invalid response on attempt ${attempt}`);
            } catch (apiError) {
                console.error(`API error on attempt ${attempt}:`, apiError);
                if (attempt === maxRetries) {
                    throw apiError; // Rethrow on final attempt
                }
            }
        }

        // Use fallback if enhancement is still empty
        if (!enhancedDescription) {
            console.warn('Using fallback enhancement due to empty API response');
            enhancedDescription = generateFallbackEnhancement(jobTitle, genericDescription);
        }

        return res.json({ enhancedDescription });
    } catch (error) {
        console.error('Error in enhance-description endpoint:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to enhance description' });
    }
}));

// POST /api/resumes
router.post('/', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        // Extract template from request body, default to 'modern'
        const { template = 'modern', ...resumeData } = req.body;
        const validatedData = ResumeSchema.parse(resumeData);
        console.log('Parsed resume:', JSON.stringify(validatedData, null, 2));

        const processedSkills = await Promise.all(
            validatedData.skills.map(async (skill) => {
                return prisma.skill.upsert({
                    where: { name: skill.name },
                    update: {},
                    create: { name: skill.name },
                });
            })
        );
        validatedData.skills = processedSkills;

        const processedLanguages = await Promise.all(
            validatedData.languages.map(async (lang) => {
                return prisma.language.upsert({
                    where: { name_proficiency: { name: lang.name, proficiency: lang.proficiency } },
                    update: {},
                    create: { name: lang.name, proficiency: lang.proficiency },
                });
            })
        );
        validatedData.languages = processedLanguages;

        // Create resume in database
        await prisma.resume.create({
            data: {
                userId,
                fullName: validatedData.fullName,
                email: validatedData.email,
                phone: validatedData.phone,
                address: validatedData.address,
                linkedIn: validatedData.linkedIn,
                website: validatedData.website,
                summary: validatedData.summary,
                skills: { connect: processedSkills.map((skill) => ({ id: skill.id })) },
                languages: { connect: processedLanguages.map((lang) => ({ id: lang.id })) },
                workExperiences: {
                    create: validatedData.workExperience.map((exp) => ({
                        jobTitle: exp.jobTitle,
                        company: exp.company,
                        location: exp.location,
                        startDate: new Date(exp.startDate),
                        endDate: exp.endDate ? new Date(exp.endDate) : null,
                        description: exp.description,
                    })),
                },
                educations: {
                    create: validatedData.education.map((edu) => ({
                        degree: edu.degree,
                        major: edu.major,
                        institution: edu.institution,
                        graduationYear: edu.graduationYear,
                        gpa: edu.gpa,
                        description: edu.description,
                    })),
                },
                certifications: {
                    create: validatedData.certifications.map((cert) => ({
                        name: cert.name,
                        issuer: cert.issuer,
                        issueDate: cert.issueDate ? new Date(cert.issueDate) : null,
                    })),
                },
            },
        });

        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(validatedData, template);

        // Set up response headers
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename=resume.pdf',
        });

        // Pipe the PDF directly to the response
        doc.pipe(res);
        doc.end();

        return;
    } catch (error) {
        console.error('Error in resume endpoint:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to generate PDF' });
    }
}));

export default router;