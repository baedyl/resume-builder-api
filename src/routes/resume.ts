import express from 'express';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import OpenAI from 'openai';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import multer, { FileFilterCallback } from 'multer';
import type { Multer } from 'multer';
import type { AxiosResponse } from 'axios';
import axios from 'axios';
import { requirePremium } from '../middleware/subscription';

const prisma = new PrismaClient();
const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
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

// Multer setup for file uploads (max 5MB, allowed types)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, DOC, DOCX, and TXT are allowed.'));
        }
    }
});

router.post('/enhance-summary', asyncHandler(async (req: any, res) => {
    try {
        // Parse and validate the request body
        const { summary } = EnhanceSummarySchema.parse(req.body);

        // Define the prompt for ChatGPT
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
                const response = await openai.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.7 + (attempt - 1) * 0.1, // Increase creativity on retries
                    max_tokens: 500 + (attempt - 1) * 100, // Increase token limit on retries
                });

                console.log(`OpenAI response (attempt ${attempt}):`, JSON.stringify(response, null, 2));

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
                const response = await openai.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.7 + (attempt - 1) * 0.1, // Slightly increase creativity on retries
                    max_tokens: 500 + (attempt - 1) * 100, // Increase token limit on retries
                });

                console.log(`OpenAI response (attempt ${attempt}):`, JSON.stringify(response, null, 2));

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
                    create: validatedData.workExperience.map((exp: any) => ({
                        jobTitle: exp.jobTitle,
                        company: exp.company,
                        location: exp.location,
                        startDate: new Date(exp.startDate),
                        endDate: exp.endDate ? new Date(exp.endDate) : null,
                        description: exp.description,
                    })),
                },
                educations: {
                    create: validatedData.education.map((edu: any) => ({
                        degree: edu.degree,
                        major: edu.major,
                        institution: edu.institution,
                        graduationYear: edu.graduationYear,
                        gpa: edu.gpa,
                        description: edu.description,
                    })),
                },
                certifications: {
                    create: validatedData.certifications.map((cert: any) => ({
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

// GET /api/resumes - List all resumes for the current user
router.get('/', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const resumes = await prisma.resume.findMany({
            where: { userId },
            select: {
                id: true,
                fullName: true,
                email: true,
                createdAt: true,
                updatedAt: true,
                workExperiences: {
                    select: {
                        jobTitle: true,
                        company: true,
                        startDate: true,
                        endDate: true,
                    },
                    orderBy: { startDate: 'desc' },
                    take: 1,
                },
            },
            orderBy: { updatedAt: 'desc' },
        });

        return res.json(resumes);
    } catch (error) {
        console.error('Error fetching resumes:', error);
        return res.status(500).json({ error: 'Failed to fetch resumes' });
    }
}));

// GET /api/resumes/:id - Get a specific resume
router.get('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        const resume = await prisma.resume.findFirst({
            where: {
                id: resumeId,
                userId,
            },
            include: {
                skills: true,
                languages: true,
                workExperiences: {
                    orderBy: { startDate: 'desc' },
                },
                educations: {
                    orderBy: { graduationYear: 'desc' },
                },
                certifications: {
                    orderBy: { issueDate: 'desc' },
                },
            },
        });

        if (!resume) {
            return res.status(404).json({ error: 'Resume not found' });
        }

        // Transform the data to match the expected format
        const transformedResume = {
            id: resume.id,
            fullName: resume.fullName,
            email: resume.email,
            phone: resume.phone,
            address: resume.address,
            linkedIn: resume.linkedIn,
            website: resume.website,
            summary: resume.summary,
            skills: resume.skills,
            languages: resume.languages,
            workExperience: resume.workExperiences.map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate.toISOString(),
                endDate: exp.endDate?.toISOString(),
                description: exp.description,
            })),
            education: resume.educations.map((edu: any) => ({
                degree: edu.degree,
                major: edu.major,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                gpa: edu.gpa,
                description: edu.description,
            })),
            certifications: resume.certifications.map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate?.toISOString(),
            })),
            createdAt: resume.createdAt,
            updatedAt: resume.updatedAt,
        };

        return res.json(transformedResume);
    } catch (error) {
        console.error('Error fetching resume:', error);
        return res.status(500).json({ error: 'Failed to fetch resume' });
    }
}));

// PUT /api/resumes/:id - Update a specific resume
router.put('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'modern', ...resumeData } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        // Verify resume exists and belongs to user
        const existingResume = await prisma.resume.findFirst({
            where: {
                id: resumeId,
                userId,
            },
        });

        if (!existingResume) {
            return res.status(404).json({ error: 'Resume not found' });
        }

        const validatedData = ResumeSchema.parse(resumeData);

        // Process skills and languages
        const processedSkills = await Promise.all(
            validatedData.skills.map(async (skill) => {
                return prisma.skill.upsert({
                    where: { name: skill.name },
                    update: {},
                    create: { name: skill.name },
                });
            })
        );

        const processedLanguages = await Promise.all(
            validatedData.languages.map(async (lang) => {
                return prisma.language.upsert({
                    where: { name_proficiency: { name: lang.name, proficiency: lang.proficiency } },
                    update: {},
                    create: { name: lang.name, proficiency: lang.proficiency },
                });
            })
        );

        // Update resume using transaction to ensure data consistency
        await prisma.$transaction(async (tx: any) => {
            // Delete existing relations
            await tx.workExperience.deleteMany({ where: { resumeId } });
            await tx.education.deleteMany({ where: { resumeId } });
            await tx.certification.deleteMany({ where: { resumeId } });
            await tx.resume.update({
                where: { id: resumeId },
                data: {
                    skills: { set: [] },
                    languages: { set: [] },
                },
            });

            // Update resume with new data
            await tx.resume.update({
                where: { id: resumeId },
                data: {
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
                        create: validatedData.workExperience.map((exp: any) => ({
                            jobTitle: exp.jobTitle,
                            company: exp.company,
                            location: exp.location,
                            startDate: new Date(exp.startDate),
                            endDate: exp.endDate ? new Date(exp.endDate) : null,
                            description: exp.description,
                        })),
                    },
                    educations: {
                        create: validatedData.education.map((edu: any) => ({
                            degree: edu.degree,
                            major: edu.major,
                            institution: edu.institution,
                            graduationYear: edu.graduationYear,
                            gpa: edu.gpa,
                            description: edu.description,
                        })),
                    },
                    certifications: {
                        create: validatedData.certifications.map((cert: any) => ({
                            name: cert.name,
                            issuer: cert.issuer,
                            issueDate: cert.issueDate ? new Date(cert.issueDate) : null,
                        })),
                    },
                },
            });
        });

        // Generate updated PDF
        const generateResume = require('../templates');
        const doc = generateResume(validatedData, template);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename=resume.pdf',
        });

        doc.pipe(res);
        doc.end();

        return;
    } catch (error) {
        console.error('Error updating resume:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to update resume' });
    }
}));

// DELETE /api/resumes/:id - Delete a specific resume
router.delete('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        // Verify resume exists and belongs to user
        const existingResume = await prisma.resume.findFirst({
            where: {
                id: resumeId,
                userId,
            },
        });

        if (!existingResume) {
            return res.status(404).json({ error: 'Resume not found' });
        }

        // Delete resume and all related data using transaction
        await prisma.$transaction(async (tx: any) => {
            // Delete all related records first
            await tx.workExperience.deleteMany({ where: { resumeId } });
            await tx.education.deleteMany({ where: { resumeId } });
            await tx.certification.deleteMany({ where: { resumeId } });

            // Finally delete the resume
            await tx.resume.delete({
                where: { id: resumeId },
            });
        });

        return res.status(204).send();
    } catch (error) {
        console.error('Error deleting resume:', error);
        return res.status(500).json({ error: 'Failed to delete resume' });
    }
}));

// POST /api/resumes/:id/pdf - Generate PDF for a specific resume
router.post('/:id/pdf', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = req.params.id;
        const { template = 'modern', ...resumeData } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        let validatedData;

        if (resumeId === 'new') {
            // For new resumes, validate the provided data
            validatedData = ResumeSchema.parse(resumeData);
        } else {
            // For existing resumes, fetch from database
            const parsedId = parseInt(resumeId, 10);
            if (isNaN(parsedId)) {
                return res.status(400).json({ error: 'Invalid resume ID' });
            }

            const existingResume = await prisma.resume.findFirst({
                where: {
                    id: parsedId,
                    userId,
                },
                include: {
                    skills: true,
                    languages: true,
                    workExperiences: {
                        orderBy: { startDate: 'desc' },
                    },
                    educations: {
                        orderBy: { graduationYear: 'desc' },
                    },
                    certifications: {
                        orderBy: { issueDate: 'desc' },
                    },
                },
            });

            if (!existingResume) {
                return res.status(404).json({ error: 'Resume not found' });
            }

            // Convert database model to the format expected by the template
            validatedData = {
                fullName: existingResume.fullName,
                email: existingResume.email,
                phone: existingResume.phone,
                address: existingResume.address,
                linkedIn: existingResume.linkedIn,
                website: existingResume.website,
                summary: existingResume.summary,
                skills: existingResume.skills,
                languages: existingResume.languages,
                workExperience: existingResume.workExperiences.map((exp: any) => ({
                    jobTitle: exp.jobTitle,
                    company: exp.company,
                    location: exp.location,
                    startDate: exp.startDate.toISOString(),
                    endDate: exp.endDate?.toISOString(),
                    description: exp.description,
                })),
                education: existingResume.educations.map((edu: any) => ({
                    degree: edu.degree,
                    major: edu.major,
                    institution: edu.institution,
                    graduationYear: edu.graduationYear,
                    gpa: edu.gpa,
                    description: edu.description,
                })),
                certifications: existingResume.certifications.map((cert: any) => ({
                    name: cert.name,
                    issuer: cert.issuer,
                    issueDate: cert.issueDate?.toISOString(),
                })),
            };
        }

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
        console.error('Error generating PDF:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to generate PDF' });
    }
}));

// POST /api/resumes/:id/enhance-pdf - Enhance resume for a job description and return as PDF
router.post('/:id/enhance-pdf', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { jobDescription, template = 'modern' } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }
        if (!jobDescription || typeof jobDescription !== 'string') {
            return res.status(400).json({ error: 'Job description is required' });
        }

        // Fetch the resume
        const resume = await prisma.resume.findFirst({
            where: { id: resumeId, userId },
            include: {
                skills: true,
                languages: true,
                workExperiences: { orderBy: { startDate: 'desc' } },
                educations: { orderBy: { graduationYear: 'desc' } },
                certifications: { orderBy: { issueDate: 'desc' } },
            },
        });
        if (!resume) {
            return res.status(404).json({ error: 'Resume not found' });
        }

        // Prepare the resume data for enhancement
        const resumeData = {
            fullName: resume.fullName,
            email: resume.email,
            phone: resume.phone,
            address: resume.address,
            linkedIn: resume.linkedIn,
            website: resume.website,
            summary: resume.summary,
            skills: resume.skills,
            languages: resume.languages,
            workExperience: resume.workExperiences.map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate.toISOString(),
                endDate: exp.endDate?.toISOString(),
                description: exp.description,
            })),
            education: resume.educations.map((edu: any) => ({
                degree: edu.degree,
                major: edu.major,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                gpa: edu.gpa,
                description: edu.description,
            })),
            certifications: resume.certifications.map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate?.toISOString(),
            })),
        };

        // Detect language of the job description
        const { detect } = require('langdetect');
        const detected = detect(jobDescription);
        const langCode = Array.isArray(detected) && detected.length > 0 ? detected[0].lang : 'en';
        let language = 'English';
        let languageInstruction = '';
        
        if (langCode !== 'en' && langCode !== 'und') {
            const langs = (await import('langs')).default;
            const langObj = langs.where('1', langCode); // '1' for ISO 639-1 code
            if (langObj && langObj.name) {
                language = langObj.name;
                languageInstruction = `IMPORTANT: The job description is in ${language}. You must return the enhanced resume content (summary, job descriptions, etc.) in ${language}. Keep technical terms and proper nouns as appropriate.`;
            }
        }

        // Compose the enhancement prompt
        const prompt: string = `You are an expert resume writer. Enhance the following resume to best match the provided job description. Use strong, relevant language, optimize for ATS, and tailor the summary, work experience, and skills to the job requirements. ${languageInstruction} Return the enhanced resume as structured JSON in the following format:

{
  fullName,
  email,
  phone,
  address,
  linkedIn,
  website,
  summary,
  skills: [{ name }],
  languages: [{ name, proficiency }],
  workExperience: [{ jobTitle, company, location, startDate, endDate, description }],
  education: [{ degree, major, institution, graduationYear, gpa, description }],
  certifications: [{ name, issuer, issueDate }]
}

Job Description:
${jobDescription}

Resume:
${JSON.stringify(resumeData, null, 2)}
`;

        // Call OpenAI to enhance the resume
        let enhancedResume = null;
        const maxRetries = 2;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await openai.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.7 + (attempt - 1) * 0.1,
                    max_tokens: 1800,
                });
                const content = response.choices[0]?.message?.content?.trim();
                if (content) {
                    // Try to extract JSON from the response
                    let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
                    let jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : null;
                    if (jsonStr) {
                        try {
                            enhancedResume = JSON.parse(jsonStr);
                            break;
                        } catch (e) {
                            // Try to fix common JSON issues
                            try {
                                enhancedResume = JSON.parse(jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
                                break;
                            } catch (e2) { }
                        }
                    }
                }
            } catch (apiError) {
                if (attempt === maxRetries) throw apiError;
            }
        }
        if (!enhancedResume) {
            return res.status(500).json({ error: 'Failed to enhance resume' });
        }

        // Save the enhanced resume to the database
        // Process skills and languages first
        const processedSkills = await Promise.all(
            (enhancedResume.skills || []).map(async (skill: any) => {
                return prisma.skill.upsert({
                    where: { name: skill.name },
                    update: {},
                    create: { name: skill.name },
                });
            })
        );

        const processedLanguages = await Promise.all(
            (enhancedResume.languages || []).map(async (lang: any) => {
                return prisma.language.upsert({
                    where: { name_proficiency: { name: lang.name, proficiency: lang.proficiency } },
                    update: {},
                    create: { name: lang.name, proficiency: lang.proficiency },
                });
            })
        );

        // Create the enhanced resume in the database
        const savedResume = await prisma.resume.create({
            data: {
                userId,
                fullName: enhancedResume.fullName,
                email: enhancedResume.email,
                phone: enhancedResume.phone,
                address: enhancedResume.address,
                linkedIn: enhancedResume.linkedIn,
                website: enhancedResume.website,
                summary: enhancedResume.summary,
                skills: { connect: processedSkills.map((skill) => ({ id: skill.id })) },
                languages: { connect: processedLanguages.map((lang) => ({ id: lang.id })) },
                workExperiences: {
                    create: (enhancedResume.workExperience || []).map((exp: any) => ({
                        jobTitle: exp.jobTitle,
                        company: exp.company,
                        location: exp.location,
                        startDate: new Date(exp.startDate),
                        endDate: exp.endDate ? new Date(exp.endDate) : null,
                        description: exp.description,
                    })),
                },
                educations: {
                    create: (enhancedResume.education || []).map((edu: any) => ({
                        degree: edu.degree,
                        major: edu.major,
                        institution: edu.institution,
                        graduationYear: edu.graduationYear,
                        gpa: edu.gpa,
                        description: edu.description,
                    })),
                },
                certifications: {
                    create: (enhancedResume.certifications || []).map((cert: any) => ({
                        name: cert.name,
                        issuer: cert.issuer,
                        issueDate: cert.issueDate ? new Date(cert.issueDate) : null,
                    })),
                },
            },
        });

        // Return JSON response similar to upload endpoint
        return res.json({
            enhanced: enhancedResume,
            resumeId: savedResume.id,
            message: 'Resume enhanced and saved successfully'
        });
    } catch (error) {
        console.error('Error in enhance-pdf endpoint:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to enhance and generate PDF' });
    }
}));

// POST /api/resumes/upload
router.post('/upload', ensureAuthenticated, upload.single('file'), asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        // Validate file size (already handled by multer)
        // Validate file type (already handled by multer)

        // Step 1: Upload file to OpenAI
        // @ts-ignore
        const formData = new (require('form-data'))();
        formData.append('file', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
        });
        formData.append('purpose', 'assistants');

        const openaiApiKey = process.env.OPENAI_API_KEY;
        const openaiAssistantId = process.env.OPENAI_ASSISTANT_ID;
        if (!openaiApiKey || !openaiAssistantId) {
            return res.status(500).json({ error: 'OpenAI API key or Assistant ID not configured' });
        }

        // Upload file
        const uploadResponse = await axios.post('https://api.openai.com/v1/files', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${openaiApiKey}`,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });
        const fileId = uploadResponse.data.id;

        // Step 2: Create a new thread
        const threadResponse = await axios.post('https://api.openai.com/v1/threads', {}, {
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'OpenAI-Beta': 'assistants=v2',
                'Content-Type': 'application/json',
            },
        });
        const threadId = threadResponse.data.id;

        // Step 3: Add message to thread with file attachment
        const messageData = {
            role: 'user',
            content: 'Please extract key information from this CV and return it as JSON format with the following structure: { personal_info: { fullName, email, phone, address, linkedIn, website }, work_experience: [{ company, jobTitle, startDate, endDate, description }], education: [{ institution, degree, major, graduationYear }], skills: [{ id, name }], languages: [{ name, proficiency }], certifications: [{ name, issuer, issueDate (optional) }] }',
            attachments: [
                {
                    file_id: fileId,
                    tools: [{ type: 'file_search' }],
                },
            ],
        };
        await axios.post(`https://api.openai.com/v1/threads/${threadId}/messages`, messageData, {
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'OpenAI-Beta': 'assistants=v2',
                'Content-Type': 'application/json',
            },
        });

        // Step 4: Create and run the assistant
        const runData = { assistant_id: openaiAssistantId };
        const runResponse = await axios.post(`https://api.openai.com/v1/threads/${threadId}/runs`, runData, {
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'OpenAI-Beta': 'assistants=v2',
                'Content-Type': 'application/json',
            },
        });
        const runId = runResponse.data.id;

        // Step 5: Poll for completion
        let attempts = 0;
        const maxAttempts = 30;
        let status = '';
        let lastError = null;
        while (attempts < maxAttempts) {
            const statusResponse = await axios.get(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'OpenAI-Beta': 'assistants=v2',
                },
            });
            status = statusResponse.data.status;
            if (status === 'completed') {
                break;
            } else if (['failed', 'cancelled', 'expired'].includes(status)) {
                lastError = statusResponse.data.last_error?.message || 'Unknown error';
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempts++;
        }
        if (status !== 'completed') {
            return res.status(500).json({ error: `Analysis failed with status: ${status}. Error: ${lastError}` });
        }

        // Step 6: Get the assistant's response
        const messagesResponse = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'OpenAI-Beta': 'assistants=v2',
            },
        });
        const messages = messagesResponse.data.data;
        let extractedJson = null;
        for (const message of messages) {
            if (message.role === 'assistant') {
                const content = message.content;
                if (content && content.length > 0 && content[0].type === 'text') {
                    const responseText = content[0].text.value;
                    // Try to extract JSON from the response
                    let jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        let jsonStr = jsonMatch[1] || jsonMatch[0];
                        try {
                            extractedJson = JSON.parse(jsonStr);
                        } catch (e) {
                            // Try to fix common JSON issues (e.g., trailing commas)
                            try {
                                extractedJson = JSON.parse(jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
                            } catch (e2) {
                                extractedJson = null;
                            }
                        }
                    }
                }
            }
        }
        if (!extractedJson) {
            return res.status(500).json({ error: 'Failed to extract JSON from assistant response' });
        }
        return res.json({ extracted: extractedJson });
    } catch (error: any) {
        console.error('Error in file upload route:', error);
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ error: error.message });
        }
        return res.status(500).json({ error: error.message || 'Failed to process file upload' });
    }
}));

export default router;