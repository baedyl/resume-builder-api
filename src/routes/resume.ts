import express from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import multer, { FileFilterCallback } from 'multer';
import type { Multer } from 'multer';
import type { AxiosResponse } from 'axios';
import axios from 'axios';

// Import shared utilities and services
import { prisma } from '../lib/database';
import { openai } from '../lib/openai';
import { 
    WorkExperienceSchema, 
    EducationSchema, 
    SkillSchema, 
    LanguageSchema, 
    CertificationSchema 
} from '../utils/validation';
import { detectLanguage, getLanguageConfig, getLanguageInfo } from '../utils/language';
import { translateText } from '../utils/openai';
import { enhanceWithOpenAI } from '../utils/openai';
import { 
    handleValidationError, 
    handleDatabaseError, 
    handleUnauthorized, 
    handleNotFound 
} from '../utils/errorHandling';
import { 
    createResume, 
    getResumeById, 
    getUserResumes, 
    processSkills, 
    processLanguages,
    type ResumeData 
} from '../services/resumeService';
import { generateHTMLResume } from '../services/htmlResumeService';
import { requirePremium, withPremiumFeatures } from '../middleware/subscription';

const router = express.Router();

async function resolveChromeExecutablePath(puppeteer: any): Promise<string | undefined> {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && process.env.PUPPETEER_EXECUTABLE_PATH.trim().length > 0) {
        const fs = require('fs');
        if (fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    // Try common Render cache locations for @puppeteer/browsers
    try {
        const fs = require('fs');
        const path = require('path');
        const candidateCacheRoots = [
            process.env.PUPPETEER_CACHE_DIR,
            '/opt/render/.cache/puppeteer',
            '/opt/render/project/.cache/puppeteer',
            process.env.HOME ? `${process.env.HOME}/.cache/puppeteer` : undefined,
            '/root/.cache/puppeteer'
        ].filter(Boolean) as string[];
        for (const cacheDir of candidateCacheRoots) {
            if (!fs.existsSync(cacheDir)) continue;
            const chromeRoot = path.join(cacheDir, 'chrome');
            if (!fs.existsSync(chromeRoot)) continue;
            const versions = fs.readdirSync(chromeRoot).sort();
            for (let i = versions.length - 1; i >= 0; i--) {
                const verDir = path.join(chromeRoot, versions[i]);
                const linux64 = path.join(verDir, 'chrome-linux64', 'chrome');
                if (fs.existsSync(linux64)) return linux64;
                const linux = path.join(verDir, 'chrome-linux', 'chrome');
                if (fs.existsSync(linux)) return linux;
            }
        }
    } catch (_) { /* ignore */ }
    try {
        const path = await puppeteer.executablePath();
        const fs = require('fs');
        if (path && fs.existsSync(path)) return path;
        return undefined;
    } catch (_) {
        return undefined;
    }
}

// Helper to send PDFKit documents reliably by buffering and setting Content-Length
function sendPdfDocument(res: express.Response, doc: any, filename: string): void {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', pdfBuffer.length.toString());
        }
        res.end(pdfBuffer);
    });
    doc.on('error', () => {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to generate PDF' });
        } else {
            try { res.end(); } catch (_) { /* noop */ }
        }
    });
    doc.end();
}

// Enhanced schemas using shared components
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
    language: z.string().optional().default('en'), // Add language parameter
});

const ResumeUpdateSchema = z.object({
    fullName: z.string().min(1, 'Full name is required').optional(),
    email: z.string().email('Invalid email').optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    linkedIn: z.string().optional(),
    website: z.string().optional(),
    summary: z.string().optional(),
    skills: z.array(SkillSchema).default([]),
    workExperience: z.array(WorkExperienceSchema).optional(),
    education: z.array(EducationSchema).optional(),
    languages: z.array(LanguageSchema).default([]),
    certifications: z.array(CertificationSchema).default([]),
    language: z.string().optional(), // Add language parameter
});

const EnhanceDescriptionSchema = z.object({
    jobTitle: z.string().min(1, 'Job title is required'),
    description: z.string().min(1, 'Description is required'),
    language: z.string().optional().default('en'), // Add language parameter
});

const EnhanceSummarySchema = z.object({
    summary: z.string().min(1, 'Summary is required'),
    language: z.string().optional().default('en'), // Add language parameter
});

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req: Express.Request, file: Express.Multer.File, callback: FileFilterCallback) => {
        if (file.mimetype === 'application/pdf' || 
            file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.mimetype === 'application/msword') {
            callback(null, true);
        } else {
            callback(new Error('Only PDF and Word documents are allowed'));
        }
    },
});

// POST /api/resumes/enhance-summary
router.post('/enhance-summary', asyncHandler(async (req: any, res) => {
    try {
        const parsed = EnhanceSummarySchema.parse(req.body);
        const { summary, language = 'en' } = parsed;
        
        const languageConfig = getLanguageConfig(language);
        const languageInfo = getLanguageInfo(language);

        const prompt = `Enhance the following professional summary to be more impactful, ATS-friendly, and compelling. Keep it concise (2-3 sentences) and professional. ${languageInfo.instruction} Original summary: ${summary}`;

        // Create language-appropriate fallback content
        const fallbackContent = language === 'es' 
            ? "Un profesional dedicado y versátil con una sólida base en su campo. Historial comprobado de entregar resultados y adaptarse a nuevos desafíos. Comprometido con el aprendizaje continuo y el crecimiento profesional."
            : language === 'fr'
            ? "Un professionnel dévoué et polyvalent avec une solide base dans son domaine. Antécédents prouvés de livrer des résultats et s'adapter aux nouveaux défis. Engagé dans l'apprentissage continu et la croissance professionnelle."
            : "A dedicated and versatile professional with a strong foundation in their field. Proven track record of delivering results and adapting to new challenges. Committed to continuous learning and professional growth.";

        const enhancedSummary = await enhanceWithOpenAI(
            prompt,
            languageConfig.systemMessage,
            fallbackContent
        );

        return res.json({ data: enhancedSummary });
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// POST /api/resumes/enhance-description
router.post('/enhance-description', asyncHandler(async (req: any, res) => {
    try {
        const parsed = EnhanceDescriptionSchema.parse(req.body);
        const { jobTitle, description, language = 'en' } = parsed;
        
        const languageConfig = getLanguageConfig(language);
        const languageInfo = getLanguageInfo(language);

        const prompt = `Enhance the following job description for a ${jobTitle} position. Make it more impactful with action verbs, quantifiable achievements, and ATS-friendly keywords. Return as bullet points with •. Format with single line breaks between bullet points, no extra spacing. ${languageInfo.instruction} Original: ${description}`;

        // Create language-appropriate fallback content
        const fallbackContent = language === 'es' 
            ? `• Ejecutó responsabilidades principales como ${jobTitle}, mejorando la productividad del equipo y los resultados del proyecto.\n• Colaboró con partes interesadas para lograr objetivos organizacionales, aprovechando habilidades de experiencia previa.\n• Contribuyó a iniciativas clave, adaptándose a entornos de trabajo dinámicos`
            : language === 'fr'
            ? `• Exécuté les responsabilités principales en tant que ${jobTitle}, améliorant la productivité de l'équipe et les résultats du projet.\n• Collaboré avec les parties prenantes pour atteindre les objectifs organisationnels, en exploitant les compétences de l'expérience précédente.\n• Contribué aux initiatives clés, en s'adaptant aux environnements de travail dynamiques`
            : `• Performed core responsibilities as a ${jobTitle}, enhancing team productivity and project outcomes.\n• Collaborated with stakeholders to achieve organizational goals, leveraging skills from prior experience.\n• Contributed to key initiatives, adapting to dynamic work environments`;

        const enhancedDescription = await enhanceWithOpenAI(
            prompt,
            languageConfig.systemMessage,
            fallbackContent
        );

        return res.json({ data: enhancedDescription });
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// POST /api/resumes/new/pdf - Generate PDF from new resume data without saving
router.post('/new/pdf', ensureAuthenticated, withPremiumFeatures, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        const { template = 'modern', language = 'en', ...resumeData } = req.body;
        const validatedData = ResumeSchema.parse({ ...resumeData, language });

        // Check if user is premium, if not restrict to basic template
        const isPremium = req.user?.isPremium || false;
        const finalTemplate = isPremium ? template : 'modern';

        // Ensure skills are properly formatted for PDF template
        const pdfData = {
            ...validatedData,
            skills: validatedData.skills?.map((skill: any) => ({ name: skill.name })) || []
        };

        // Generate PDF using template without saving to database
        const generateResume = require('../templates');
        const doc = generateResume(pdfData, finalTemplate, language);

        sendPdfDocument(res, doc, 'resume.pdf');
    } catch (error) {
        if (error instanceof z.ZodError) {
            handleValidationError(error, res);
        } else {
            handleDatabaseError(error, res, 'generate PDF');
        }
    }
}));

// POST /api/resumes/new/html - Generate HTML from new resume data without saving
router.post('/new/html', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        const { template = 'colorful', language = 'en', ...resumeData } = req.body;
        const validatedData = ResumeSchema.parse({ ...resumeData, language });

        // Convert validated data to HTML format
        const htmlResumeData = {
            fullName: validatedData.fullName,
            email: validatedData.email,
            phone: validatedData.phone || undefined,
            address: validatedData.address || undefined,
            linkedIn: validatedData.linkedIn || undefined,
            website: validatedData.website || undefined,
            summary: validatedData.summary || '',
            workExperience: validatedData.workExperience.map(exp => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
            })),
            education: validatedData.education.map(edu => ({
                degree: edu.degree,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })),
            skills: validatedData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: validatedData.languages || [],
        };

        // Determine effective language: prefer provided, else detect from content
        let effectiveLanguage = validatedData.language || 'en';
        if (!req.body.language) {
            try {
                const basis = (validatedData.summary || '') || (validatedData.workExperience?.[0]?.description || '');
                if (basis) {
                    const detected = await detectLanguage(basis);
                    if (detected?.code) effectiveLanguage = detected.code;
                }
            } catch {}
        }

        const html = generateHTMLResume(htmlResumeData, template as string, effectiveLanguage);

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        if (error instanceof z.ZodError) {
            handleValidationError(error, res);
        } else {
            handleDatabaseError(error, res, 'generate HTML');
        }
    }
}));

// POST /api/resumes/save-and-pdf - Save resume and return PDF
router.post('/save-and-pdf', ensureAuthenticated, withPremiumFeatures, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        const { template = 'modern', language = 'en', ...resumeData } = req.body;
        const validatedData = ResumeSchema.parse({ ...resumeData, language });

        const resume = await createResume({
            ...validatedData,
            userId
        } as ResumeData);

        // Check if user is premium, if not restrict to basic template
        const isPremium = req.user?.isPremium || false;
        const finalTemplate = isPremium ? template : 'modern';

        // Ensure skills are properly formatted for PDF template
        const pdfData = {
            ...validatedData,
            skills: validatedData.skills?.map((skill: any) => ({ name: skill.name })) || []
        };

        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(pdfData, finalTemplate, language);

        sendPdfDocument(res, doc, 'resume.pdf');
    } catch (error) {
        if (error instanceof z.ZodError) {
            handleValidationError(error, res);
        } else {
            handleDatabaseError(error, res, 'create resume');
        }
    }
}));

// GET /api/resumes/:id/download - Download saved resume as PDF (free users allowed)
router.get('/:id/download', ensureAuthenticated, withPremiumFeatures, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'modern', language = 'en' } = req.query;

        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        const resume = await getResumeById(resumeId, userId);

        if (!resume) {
            handleNotFound(res, 'Resume');
            return;
        }

        // Check if user is premium, if not restrict to basic template
        const isPremium = req.user?.isPremium || false;
        const finalTemplate = isPremium ? (template as string) : 'modern';

        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(resume, finalTemplate, language as string);

        sendPdfDocument(res, doc, 'resume.pdf');
    } catch (error) {
        handleDatabaseError(error, res, 'generate PDF');
    }
}));

// POST /api/resumes - Save resume and return data (for debugging)
router.post('/', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        const { template = 'modern', ...resumeData } = req.body;
        console.log('Received work experience count:', resumeData.workExperience?.length || 0);
        
        const validatedData = ResumeSchema.parse(resumeData);
        console.log('Validated work experience count:', validatedData.workExperience?.length || 0);

        const resume = await createResume({
            ...validatedData,
            userId
        } as ResumeData);

        // Fetch the complete resume with all relations to verify data was saved
        const completeResume = await getResumeById(resume.id, userId);
        
        console.log('Saved work experiences:', completeResume?.workExperiences?.length || 0);

        // Return the saved resume data instead of PDF for debugging
        res.json({
            success: true,
            resumeId: resume.id,
            workExperiencesCount: completeResume?.workExperiences?.length || 0,
            resume: completeResume
        });
    } catch (error) {
        console.error('Error saving resume:', error);
        if (error instanceof z.ZodError) {
            console.error('Validation errors:', error.errors);
            handleValidationError(error, res);
        } else {
            handleDatabaseError(error, res, 'create resume');
        }
    }
}));

// GET /api/resumes
router.get('/', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        const resumes = await getUserResumes(userId);
        res.json(resumes);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch resumes');
    }
}));

// GET /api/resumes/:id
router.get('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);

        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        const resume = await getResumeById(resumeId, userId);

        if (!resume) {
            handleNotFound(res, 'Resume');
            return;
        }

        res.json(resume);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch resume');
    }
}));

// PUT /api/resumes/:id - Update a specific resume
router.put('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);

        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        const validatedData = ResumeUpdateSchema.parse(req.body);

        // Check if resume exists and belongs to user
        const existingResume = await getResumeById(resumeId, userId);
        if (!existingResume) {
            handleNotFound(res, 'Resume');
            return;
        }

        // Process skills and languages
        const processedSkills = await processSkills(validatedData.skills);
        const processedLanguages = await processLanguages(validatedData.languages);

        // If language is explicitly set to French, translate provided textual fields
        if (validatedData.language && validatedData.language.toLowerCase() === 'fr') {
            if (validatedData.summary) {
                validatedData.summary = await translateText(validatedData.summary, 'fr');
            }
            if (validatedData.workExperience && validatedData.workExperience.length > 0) {
                validatedData.workExperience = await Promise.all(validatedData.workExperience.map(async (exp) => ({
                    ...exp,
                    jobTitle: exp.jobTitle ? await translateText(exp.jobTitle, 'fr') : exp.jobTitle,
                    company: exp.company, // company names typically unchanged
                    location: exp.location ? await translateText(exp.location, 'fr') : exp.location,
                    description: exp.description ? await translateText(exp.description, 'fr') : exp.description,
                })));
            }
            if (validatedData.education && validatedData.education.length > 0) {
                validatedData.education = await Promise.all(validatedData.education.map(async (edu) => ({
                    ...edu,
                    degree: edu.degree ? await translateText(edu.degree, 'fr') : edu.degree,
                    major: edu.major ? await translateText(edu.major, 'fr') : edu.major,
                    institution: edu.institution, // proper noun
                    description: edu.description ? await translateText(edu.description, 'fr') : edu.description,
                })));
            }
            if (validatedData.certifications && validatedData.certifications.length > 0) {
                validatedData.certifications = await Promise.all(validatedData.certifications.map(async (cert) => ({
                    ...cert,
                    name: cert.name ? await translateText(cert.name, 'fr') : cert.name,
                    issuer: cert.issuer, // proper noun
                })));
            }
            // Skills and language labels are often proper nouns; keep as provided
        }

        // Update the resume with cascade updates
        const updateData: any = {};
        
        // Only update fields that are provided
        if (validatedData.fullName !== undefined) updateData.fullName = validatedData.fullName;
        if (validatedData.email !== undefined) updateData.email = validatedData.email;
        if (validatedData.phone !== undefined) updateData.phone = validatedData.phone;
        if (validatedData.address !== undefined) updateData.address = validatedData.address;
        if (validatedData.linkedIn !== undefined) updateData.linkedIn = validatedData.linkedIn;
        if (validatedData.website !== undefined) updateData.website = validatedData.website;
        if (validatedData.summary !== undefined) updateData.summary = validatedData.summary;
        
        // Update skills and languages if provided
        if (validatedData.skills && validatedData.skills.length > 0) {
            updateData.skills = { 
                set: [], // Clear existing connections
                connect: processedSkills.map((skill) => ({ id: skill.id }))
            };
        }
        
        if (validatedData.languages && validatedData.languages.length > 0) {
            updateData.languages = { 
                set: [], // Clear existing connections
                connect: processedLanguages.map((lang) => ({ id: lang.id }))
            };
        }
        
        // Update work experiences if provided
        if (validatedData.workExperience && validatedData.workExperience.length > 0) {
            updateData.workExperiences = {
                deleteMany: {}, // Clear existing work experiences
                create: validatedData.workExperience.map((exp) => ({
                    jobTitle: exp.jobTitle,
                    company: exp.company,
                    location: exp.location,
                    startDate: new Date(exp.startDate),
                    endDate: exp.endDate ? new Date(exp.endDate) : null,
                    description: exp.description,
                })),
            };
        }
        
        // Update educations if provided
        if (validatedData.education && validatedData.education.length > 0) {
            updateData.educations = {
                deleteMany: {}, // Clear existing educations
                create: validatedData.education.map((edu) => ({
                    degree: edu.degree,
                    major: edu.major,
                    institution: edu.institution,
                    graduationYear: edu.graduationYear,
                    gpa: edu.gpa,
                    description: edu.description,
                })),
            };
        }
        
        // Update certifications if provided
        if (validatedData.certifications && validatedData.certifications.length > 0) {
            updateData.certifications = {
                deleteMany: {}, // Clear existing certifications
                create: validatedData.certifications.map((cert) => ({
                    name: cert.name,
                    issuer: cert.issuer,
                    issueDate: cert.issueDate ? new Date(cert.issueDate) : null,
                })),
            };
        }

        const updatedResume = await prisma.resume.update({
            where: { id: resumeId },
            data: updateData,
            include: {
                skills: true,
                languages: true,
                workExperiences: true,
                educations: true,
                certifications: true,
            },
        });

        res.json(updatedResume);
    } catch (error) {
        if (error instanceof z.ZodError) {
            handleValidationError(error, res);
        } else {
            handleDatabaseError(error, res, 'update resume');
        }
    }
}));

// DELETE /api/resumes/:id - Delete a specific resume
router.delete('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);

        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        // Check if resume exists and belongs to user
        const existingResume = await getResumeById(resumeId, userId);
        if (!existingResume) {
            handleNotFound(res, 'Resume');
            return;
        }

        // Delete the resume (cascading deletes will handle related records)
        await prisma.resume.delete({
            where: { id: resumeId },
        });

        res.status(204).send();
    } catch (error) {
        handleDatabaseError(error, res, 'delete resume');
    }
}));

// POST /api/resumes/:id/pdf
router.post('/:id/pdf', ensureAuthenticated, withPremiumFeatures, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'modern', language: reqLanguage } = req.body;

        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        const resume = await getResumeById(resumeId, userId);

        if (!resume) {
            handleNotFound(res, 'Resume');
            return;
        }

        // Check if user is premium, if not restrict to basic template
        const isPremium = req.user?.isPremium || false;
        const finalTemplate = isPremium ? template : 'modern'; // Free users get modern template only

        // Convert resume data to PDF format
        const pdfData = {
            fullName: resume.fullName,
            email: resume.email,
            phone: resume.phone || undefined,
            address: resume.address || undefined,
            linkedIn: resume.linkedIn || undefined,
            website: resume.website || undefined,
            summary: resume.summary || '',
            workExperience: resume.workExperiences?.map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
            })) || [],
            education: resume.educations?.map((edu: any) => ({
                degree: edu.degree,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: resume.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: resume.languages || [],
        };

        // Generate PDF using template
        // Determine language: use provided or detect from content
        let effectiveLanguage = (reqLanguage as string) || 'en';
        try {
            if (!reqLanguage) {
                const basis = resume.summary || resume.workExperiences?.[0]?.description || '';
                if (basis && basis.length > 0) {
                    const detected = await detectLanguage(basis);
                    if (detected?.code) effectiveLanguage = detected.code;
                }
            }
        } catch {}

        const generateResume = require('../templates');
        const doc = generateResume(pdfData, finalTemplate, effectiveLanguage);

        sendPdfDocument(res, doc, 'resume.pdf');
    } catch (error) {
        handleDatabaseError(error, res, 'generate PDF');
    }
}));

// POST /api/resumes/:id/enhance-pdf - Keep premium only
router.post('/:id/enhance-pdf', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { jobDescription, template = 'modern', language = 'en' } = req.body;

        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        if (!jobDescription || typeof jobDescription !== 'string') {
            return res.status(400).json({ error: 'Job description is required' });
        }

        const resume = await getResumeById(resumeId, userId);
        if (!resume) {
            handleNotFound(res, 'Resume');
            return;
        }

        // Get language configuration
        const languageConfig = getLanguageConfig(language);
        const languageInfo = getLanguageInfo(language);

        // Prepare resume data for enhancement
        const resumeData: any = {
            fullName: resume.fullName,
            email: resume.email,
            phone: resume.phone,
            address: resume.address,
            linkedIn: resume.linkedIn,
            website: resume.website,
            summary: resume.summary,
            skills: resume.skills,
            languages: resume.languages,
            workExperience: resume.workExperiences?.map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
            })) || [],
            education: resume.educations?.map((edu: any) => ({
                degree: edu.degree,
                major: edu.major,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                gpa: edu.gpa,
                description: edu.description,
            })) || [],
            certifications: resume.certifications?.map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate,
            })) || [],
        };

        // Extract and match skills from job description
        console.log('Extracting skills from job description...');
        const matchedSkills = await extractAndMatchSkills(jobDescription, resume.skills || [], language);
        console.log(`Found ${matchedSkills.length} matched skills from job description`);
        
        // Create enhanced skills list combining matched skills with existing resume skills
        const enhancedSkills = [...(resume.skills || []), ...matchedSkills];
        
        // Remove duplicates based on skill name
        const uniqueSkills = enhancedSkills.filter((skill, index, self) => 
            index === self.findIndex(s => s.name.toLowerCase() === skill.name.toLowerCase())
        );
        
        console.log(`Total unique skills for enhancement: ${uniqueSkills.length}`);
        console.log('Skills to include:', uniqueSkills.map(skill => skill.name));

        const prompt: string = `You are an expert resume writer. Enhance the following resume to best match the provided job description. Use strong, relevant language, optimize for ATS, and tailor the summary, work experience, and skills to the job requirements. ${languageInfo.instruction} 

IMPORTANT: 
1. For all work experience descriptions, format them as bullet points using the • symbol. Each bullet point should start with a strong action verb and be quantifiable when possible.
2. Include the following matched skills in the skills section: ${uniqueSkills.map(skill => skill.name).join(', ')}
3. Focus on skills that are relevant to the job description and will help pass ATS systems.

Return the enhanced resume as structured JSON in the following format:

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

Matched Skills to Include:
${uniqueSkills.map(skill => skill.name).join(', ')}
`;

        // Call OpenAI to enhance the resume
        let enhancedResume = null;
        const maxRetries = 2;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await openai.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        { role: 'system', content: languageConfig.systemMessage },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.7,
                    max_tokens: 2000,
                });

                const content = response.choices[0]?.message?.content?.trim();
                if (content) {
                    try {
                        enhancedResume = JSON.parse(content);
                        break;
                    } catch (parseError) {
                        console.warn(`JSON parse error on attempt ${attempt}:`, parseError);
                    }
                }
            } catch (apiError) {
                console.error(`API error on attempt ${attempt}:`, apiError);
                if (attempt === maxRetries) {
                    throw apiError;
                }
            }
        }

        if (!enhancedResume) {
            return res.status(500).json({ error: 'Failed to enhance resume' });
        }

        // Save the enhanced resume to the database
        const processedSkills = await processSkills(enhancedResume.skills || []);
        const processedLanguages = await processLanguages(enhancedResume.languages || []);

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
            message: 'Resume enhanced and saved successfully',
            matchedSkills: uniqueSkills.map(skill => skill.name),
            totalSkillsMatched: uniqueSkills.length
        });
    } catch (error: any) {
        console.error('Error in enhance-pdf endpoint:', error);
        res.status(500).json({ error: 'Failed to enhance resume' });
    }
}));

// POST /api/resumes/:id/html - Get resume as HTML
router.post('/:id/html', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'colorful', language = 'en' } = req.query as any;

        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        const resume = await getResumeById(resumeId, userId);
        if (!resume) {
            handleNotFound(res, 'Resume');
            return;
        }

        // Convert resume data to HTML format
        const resumeData = {
            fullName: resume.fullName,
            email: resume.email,
            phone: resume.phone || undefined,
            address: resume.address || undefined,
            linkedIn: resume.linkedIn || undefined,
            website: resume.website || undefined,
            summary: resume.summary || '',
            workExperience: resume.workExperiences?.map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
            })) || [],
            education: resume.educations?.map((edu: any) => ({
                degree: edu.degree,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: resume.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: resume.languages || [],
        };

        // Determine effective language for preview: prefer query param, else detect
        let effectiveLanguage = (language as string) || 'en';
        if (!req.query.language) {
            try {
                const basis = (resume.summary || '') || (resume.workExperiences?.[0]?.description || '');
                if (basis) {
                    const detected = await detectLanguage(basis);
                    if (detected?.code) effectiveLanguage = detected.code;
                }
            } catch {}
        }

        const html = generateHTMLResume(resumeData, template as string, effectiveLanguage);

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (error: any) {
        console.error('Error in HTML resume endpoint:', error);
        res.status(500).json({ error: 'Failed to generate HTML resume' });
    }
}));

// POST /api/resumes/save-and-html-pdf - Save new resume and return PDF from HTML template
router.post('/save-and-html-pdf', ensureAuthenticated, withPremiumFeatures, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        const { template = 'colorful', language = 'en', ...resumeData } = req.body;
        const validatedData = ResumeSchema.parse({ ...resumeData, language });

        // Save the resume to database first
        const resume = await createResume({
            ...validatedData,
            userId
        } as ResumeData);

        // Convert resume data to HTML format
        const htmlResumeData = {
            fullName: validatedData.fullName,
            email: validatedData.email,
            phone: validatedData.phone || undefined,
            address: validatedData.address || undefined,
            linkedIn: validatedData.linkedIn || undefined,
            website: validatedData.website || undefined,
            summary: validatedData.summary || '',
            workExperience: validatedData.workExperience.map(exp => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
            })),
            education: validatedData.education.map(edu => ({
                degree: edu.degree,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })),
            skills: validatedData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: validatedData.languages || [],
        };

        // Generate HTML
        // Determine effective language: prefer provided, else detect from summary/experience
        let effectiveLanguage = (language as string) || 'en';
        if (!req.body.language) {
            try {
                const basis = (validatedData.summary || '') || (validatedData.workExperience?.[0]?.description || '');
                if (basis) {
                    const detected = await detectLanguage(basis);
                    if (detected?.code) effectiveLanguage = detected.code;
                }
            } catch {}
        }
        const html = generateHTMLResume(htmlResumeData, template as string, effectiveLanguage);

        // Convert HTML to PDF using Puppeteer
        const puppeteer = require('puppeteer');
        const executablePath = await resolveChromeExecutablePath(puppeteer);
        const launchOptions: any = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        };
        if (executablePath) launchOptions.executablePath = executablePath;
        const browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        
        // Set content and wait for rendering
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        // Generate PDF
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20mm',
                right: '20mm',
                bottom: '20mm',
                left: '20mm'
            }
        });

        await browser.close();

        // Return PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
        res.setHeader('Content-Length', Buffer.byteLength(pdf).toString());
        res.end(pdf);

    } catch (error) {
        if (error instanceof z.ZodError) {
            handleValidationError(error, res);
        } else {
            handleDatabaseError(error, res, 'generate HTML PDF');
        }
    }
}));

// POST /api/resumes/:id/html-pdf - Convert existing resume to PDF using HTML template
router.post('/:id/html-pdf', ensureAuthenticated, withPremiumFeatures, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'colorful', language = 'en' } = req.body;

        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }

        const resume = await getResumeById(resumeId, userId);
        if (!resume) {
            handleNotFound(res, 'Resume');
            return;
        }

        // Convert resume data to HTML format
        const resumeData = {
            fullName: resume.fullName,
            email: resume.email,
            phone: resume.phone || undefined,
            address: resume.address || undefined,
            linkedIn: resume.linkedIn || undefined,
            website: resume.website || undefined,
            summary: resume.summary || '',
            workExperience: resume.workExperiences?.map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
            })) || [],
            education: resume.educations?.map((edu: any) => ({
                degree: edu.degree,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: resume.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: resume.languages || [],
        };

        // Generate HTML
        // Determine effective language: prefer provided, else detect from saved content
        let effectiveLanguage = (language as string) || 'en';
        if (!req.body.language) {
            try {
                const basis = (resume.summary || '') || (resume.workExperiences?.[0]?.description || '');
                if (basis) {
                    const detected = await detectLanguage(basis);
                    if (detected?.code) effectiveLanguage = detected.code;
                }
            } catch {}
        }
        const html = generateHTMLResume(resumeData, template as string, effectiveLanguage);

        // Convert HTML to PDF using Puppeteer
        const puppeteer = require('puppeteer');
        const executablePath = await resolveChromeExecutablePath(puppeteer);
        const launchOptions2: any = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        };
        if (executablePath) launchOptions2.executablePath = executablePath;
        const browser = await puppeteer.launch(launchOptions2);
        const page = await browser.newPage();
        
        // Set content and wait for rendering
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        // Generate PDF
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20mm',
                right: '20mm',
                bottom: '20mm',
                left: '20mm'
            }
        });

        await browser.close();

        // Return PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
        res.setHeader('Content-Length', Buffer.byteLength(pdf).toString());
        res.end(pdf);

    } catch (error: any) {
        console.error('Error in HTML PDF endpoint:', error);
        res.status(500).json({ error: 'Failed to generate HTML PDF' });
    }
}));

// POST /api/resumes/upload
router.post('/upload', ensureAuthenticated, upload.single('file'), asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            handleUnauthorized(res);
            return;
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Step 1: Upload file to OpenAI
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

        // Step 3: Add a message to the thread with the file attachment
        const messageResponse = await axios.post(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            role: 'user',
            content: 'Please extract the information from this resume and return it in the specified JSON format.',
            attachments: [
                {
                    file_id: fileId,
                    tools: [{ type: 'file_search' }]
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'OpenAI-Beta': 'assistants=v2',
                'Content-Type': 'application/json',
            },
        });

        // Step 4: Run the assistant
        const runResponse = await axios.post(`https://api.openai.com/v1/threads/${threadId}/runs`, {
            assistant_id: openaiAssistantId,
        }, {
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'OpenAI-Beta': 'assistants=v2',
                'Content-Type': 'application/json',
            },
        });
        const runId = runResponse.data.id;

        // Step 5: Poll for completion
        let runStatus = 'in_progress';
        let pollAttempts = 0;
        const maxPollAttempts = 30; // 5 minutes max

        while (runStatus === 'in_progress' || runStatus === 'queued') {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            pollAttempts++;

            if (pollAttempts > maxPollAttempts) {
                return res.status(408).json({ error: 'Processing timeout' });
            }

            const statusResponse = await axios.get(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'OpenAI-Beta': 'assistants=v2',
                },
            });
            runStatus = statusResponse.data.status;
        }

        if (runStatus !== 'completed') {
            return res.status(500).json({ error: `Processing failed with status: ${runStatus}` });
        }

        // Step 6: Retrieve the messages
        const messagesResponse = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'OpenAI-Beta': 'assistants=v2',
            },
        });

        const messages = messagesResponse.data.data;
        const assistantMessage = messages.find((msg: any) => msg.role === 'assistant');

        if (!assistantMessage || !assistantMessage.content || !assistantMessage.content[0]) {
            return res.status(500).json({ error: 'No response from assistant' });
        }

        const extractedText = assistantMessage.content[0].text.value;

        // Parse the JSON response
        let parsedData;
        try {
            const jsonMatch = extractedText.match(/```json\n([\s\S]*?)\n```/) || extractedText.match(/```\n([\s\S]*?)\n```/) || extractedText.match(/({[\s\S]*})/);
            if (jsonMatch) {
                parsedData = JSON.parse(jsonMatch[1]);
            } else {
                parsedData = JSON.parse(extractedText);
            }
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            console.log('Extracted text:', extractedText);
            return res.status(500).json({ error: 'Failed to parse extracted data' });
        }

        // Clean up: Delete the uploaded file
        try {
            await axios.delete(`https://api.openai.com/v1/files/${fileId}`, {
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                },
            });
        } catch (deleteError) {
            console.warn('Failed to delete uploaded file:', deleteError);
        }

        res.json(parsedData);
    } catch (error: any) {
        console.error('Error in upload endpoint:', error);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
        res.status(500).json({ error: 'Failed to process resume' });
    }
}));

// GET /api/resumes/subscription-status - Check user's subscription status and available features
router.get('/subscription-status', ensureAuthenticated, withPremiumFeatures, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            handleUnauthorized(res);
            return;
        }

        const isPremium = req.user?.isPremium || false;

        res.json({
            isPremium,
            availableFeatures: {
                basicPdfDownload: true, // Free users can download basic PDFs
                multipleTemplates: isPremium, // Premium users get all templates
                enhancedPdf: isPremium, // Premium users get enhanced PDFs
                aiEnhancement: isPremium, // Premium users get AI enhancement
                unlimitedResumes: isPremium, // Premium users get unlimited resumes
            },
            templates: isPremium ? ['modern', 'classic', 'minimal'] : ['modern']
        });
    } catch (error) {
        handleDatabaseError(error, res, 'check subscription status');
    }
}));

// Function to extract and match skills from job description
async function extractAndMatchSkills(jobDescription: string, resumeSkills: any[], language: string = 'en') {
    const languageConfig = getLanguageConfig(language);
    
    // Extract keywords/skills from job description using OpenAI
    const extractionPrompt = `Analyze the following job description and extract the most important technical skills, tools, technologies, and keywords that would be relevant for this position. Focus on:
1. Programming languages, frameworks, and technologies
2. Software tools and platforms
3. Methodologies and processes
4. Industry-specific skills
5. Soft skills that are explicitly mentioned

Return only the skills as a JSON array of strings, without any additional text or formatting.

Job Description:
${jobDescription}`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: languageConfig.systemMessage },
                { role: 'user', content: extractionPrompt },
            ],
            temperature: 0.3,
            max_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) {
            return [];
        }

        let extractedSkills: string[] = [];
        try {
            extractedSkills = JSON.parse(content);
        } catch (parseError) {
            console.warn('Failed to parse extracted skills:', parseError);
            return [];
        }

        // Get all existing skills from database
        const allSkills = await prisma.skill.findMany({
            select: { id: true, name: true }
        });

        // Get current resume skills
        const currentResumeSkills = resumeSkills.map(skill => skill.name.toLowerCase());

        // Match extracted skills with existing skills
        const matchedSkills: any[] = [];
        const newSkills: string[] = [];

        for (const extractedSkill of extractedSkills) {
            if (!extractedSkill || typeof extractedSkill !== 'string') {
                continue;
            }
            
            const normalizedSkill = extractedSkill.toLowerCase().trim();
            
            if (normalizedSkill.length === 0) {
                continue;
            }
            
            // Check if skill exists in database
            const existingSkill = allSkills.find(skill => 
                skill.name.toLowerCase() === normalizedSkill
            );

            if (existingSkill) {
                matchedSkills.push(existingSkill);
            } else {
                // Check if it's already in current resume
                if (currentResumeSkills.includes(normalizedSkill)) {
                    // Find the original skill object from resume
                    const resumeSkill = resumeSkills.find(skill => 
                        skill.name.toLowerCase() === normalizedSkill
                    );
                    if (resumeSkill) {
                        matchedSkills.push(resumeSkill);
                    }
                } else {
                    newSkills.push(extractedSkill);
                }
            }
        }
        
        console.log(`Matched ${matchedSkills.length} existing skills, found ${newSkills.length} new skills`);

        // Add some relevant skills that might be missing but are commonly valuable
        const additionalSkillsPrompt = `Based on the job description, suggest 3-5 additional relevant skills that would be valuable for this position but might not be explicitly mentioned. These should be complementary skills that would make a candidate more competitive.

Return only the skills as a JSON array of strings.

Job Description:
${jobDescription}`;

        const additionalResponse = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: languageConfig.systemMessage },
                { role: 'user', content: additionalSkillsPrompt },
            ],
            temperature: 0.5,
            max_tokens: 500,
        });

        const additionalContent = additionalResponse.choices[0]?.message?.content?.trim();
        if (additionalContent) {
            try {
                const additionalSkills = JSON.parse(additionalContent);
                newSkills.push(...additionalSkills);
            } catch (parseError) {
                console.warn('Failed to parse additional skills:', parseError);
            }
        }

        // Process new skills and add them to matched skills
        if (newSkills.length > 0) {
            const processedNewSkills = await processSkills(
                newSkills.map(name => ({ name }))
            );
            matchedSkills.push(...processedNewSkills);
        }

        return matchedSkills;
    } catch (error) {
        console.error('Error extracting skills from job description:', error);
        // Fallback: return original resume skills if extraction fails
        console.log('Using fallback: returning original resume skills');
        return resumeSkills;
    }
}

export default router;