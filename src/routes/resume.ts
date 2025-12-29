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
import { detectLanguage, getLanguageConfig, getLanguageInfo, normalizeLanguageCode } from '../utils/language';
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

// Preserve these tokens/terms in job titles when translating (e.g., "Senior Data Consultant" -> "Consultant Senior Data").
const JOB_TITLE_PRESERVE_TERMS = ['Data'];

async function resolveChromeExecutablePath(puppeteer: any): Promise<string | undefined> {
    const fs = require('fs');
    
    // 1. Try explicit environment variable first
    if (process.env.PUPPETEER_EXECUTABLE_PATH && process.env.PUPPETEER_EXECUTABLE_PATH.trim().length > 0) {
        if (fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            console.log(`Using PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
            return process.env.PUPPETEER_EXECUTABLE_PATH;
        }
    }

    // 2. Try Puppeteer's default resolution
    try {
        const path = puppeteer.executablePath();
        if (path && fs.existsSync(path)) {
            console.log(`Using puppeteer.executablePath(): ${path}`);
            return path;
        }
    } catch (e) {
        console.warn('puppeteer.executablePath() failed:', e);
    }

    // 3. Fallback: Try common Render/cloud cache locations
    try {
        const path = require('path');
        const candidateCacheRoots = [
            process.env.PUPPETEER_CACHE_DIR,
            '/opt/render/.cache/puppeteer',
            '/opt/render/project/.cache/puppeteer',
            process.env.HOME ? `${process.env.HOME}/.cache/puppeteer` : undefined,
            '/root/.cache/puppeteer'
        ].filter(Boolean) as string[];

        console.log('Searching for Chrome in cache roots:', candidateCacheRoots);

        for (const cacheDir of candidateCacheRoots) {
            if (!fs.existsSync(cacheDir)) continue;
            
            // Check for 'chrome' directory (newer puppeteer versions)
            const chromeRoot = path.join(cacheDir, 'chrome');
            if (fs.existsSync(chromeRoot)) {
                const versions = fs.readdirSync(chromeRoot).sort();
                for (let i = versions.length - 1; i >= 0; i--) {
                    const verDir = path.join(chromeRoot, versions[i]);
                    // Check various common binary paths
                    const candidates = [
                        path.join(verDir, 'chrome-linux64', 'chrome'),
                        path.join(verDir, 'chrome-linux', 'chrome'),
                        path.join(verDir, 'chrome'),
                    ];
                    
                    for (const candidate of candidates) {
                        if (fs.existsSync(candidate)) {
                            console.log(`Found Chrome in cache: ${candidate}`);
                            return candidate;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Manual cache search failed:', e);
    }
    
    console.warn('Could not resolve Chrome executable path');
    return undefined;
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

type ResumeSchemaInput = z.infer<typeof ResumeSchema>;

async function translateResumeContent(
    data: ResumeSchemaInput,
    targetLanguage: string
): Promise<ResumeSchemaInput> {
    const normalizedTarget = normalizeLanguageCode(targetLanguage);

    const detectionCandidates = [
        data.summary,
        data.workExperience?.find((exp) => exp.description)?.description,
        data.education?.find((edu) => edu.description)?.description
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    let sourceLanguage = 'en';
    for (const candidate of detectionCandidates) {
        try {
            const detected = await detectLanguage(candidate);
            if (detected?.code && detected.code !== 'und') {
                sourceLanguage = detected.code.toLowerCase();
                break;
            }
        } catch {
            // ignore detection errors and continue with default sourceLanguage
        }
    }

    if (sourceLanguage === normalizedTarget) {
        return {
            ...data,
            language: normalizedTarget,
        };
    }

    const translateField = async (text?: string | null): Promise<string | undefined> => {
        if (text === null || typeof text === 'undefined') return text ?? undefined;
        const trimmed = text.toString().trim();
        if (trimmed.length === 0) return text ?? undefined;
        return await translateText(trimmed, normalizedTarget);
    };

    const translateJobTitleField = async (text?: string | null): Promise<string | undefined> => {
        if (text === null || typeof text === 'undefined') return text ?? undefined;
        const trimmed = text.toString().trim();
        if (trimmed.length === 0) return text ?? undefined;
        return await translateText(trimmed, normalizedTarget, { preserveTerms: JOB_TITLE_PRESERVE_TERMS });
    };

    const translatedSummary = await translateField(data.summary);

    const translatedWorkExperience = await Promise.all(
        (data.workExperience || []).map(async (exp) => ({
            ...exp,
            jobTitle: (await translateJobTitleField(exp.jobTitle)) ?? exp.jobTitle,
            company: exp.company,
            location: (await translateField(exp.location)) ?? exp.location,
            description: (await translateField(exp.description)) ?? exp.description,
            companyDescription: (await translateField(exp.companyDescription)) ?? exp.companyDescription,
        }))
    );

    const translatedEducation = await Promise.all(
        (data.education || []).map(async (edu: any) => ({
            ...edu,
            degree: (await translateField(edu.degree)) ?? edu.degree,
            major: (await translateField(edu.major)) ?? edu.major,
            institution: edu.institution,
            description: (await translateField(edu.description)) ?? edu.description,
        }))
    );

    const translatedCertifications = await Promise.all(
        (data.certifications || []).map(async (cert) => ({
            ...cert,
            name: (await translateField(cert.name)) ?? cert.name,
            issuer: cert.issuer,
        }))
    );

    const translatedSkills = await Promise.all(
        (data.skills || []).map(async (skill) => ({
            ...skill,
            name: (await translateField(skill.name)) ?? skill.name,
        }))
    );

    return {
        ...data,
        language: normalizedTarget,
        summary: translatedSummary ?? undefined,
        workExperience: translatedWorkExperience,
        education: translatedEducation,
        certifications: translatedCertifications,
        skills: translatedSkills,
    };
}

function mapDbResumeToSchemaInput(resume: any, language: string): ResumeSchemaInput {
    return {
        fullName: resume.fullName,
        email: resume.email,
        phone: resume.phone || undefined,
        address: resume.address || undefined,
        linkedIn: resume.linkedIn || undefined,
        website: resume.website || undefined,
        summary: resume.summary || undefined,
        skills: (resume.skills || []).map((s: any) => ({ name: s.name })),
        workExperience: (resume.workExperiences || []).map((exp: any) => ({
            jobTitle: exp.jobTitle,
            company: exp.company,
            location: exp.location,
            startDate: exp.startDate,
            endDate: exp.endDate,
            description: exp.description,
            companyDescription: exp.companyDescription,
            techStack: exp.techStack,
        })),
        education: (resume.educations || []).map((edu: any) => ({
            degree: edu.degree,
            major: edu.major,
            institution: edu.institution,
            startYear: edu.startYear,
            graduationYear: edu.graduationYear,
            gpa: edu.gpa,
            description: edu.description,
        })),
        certifications: (resume.certifications || []).map((cert: any) => ({
            name: cert.name,
            issuer: cert.issuer,
            issueDate: cert.issueDate,
        })),
        languages: resume.languages || [],
        language,
    } as any;
}

// Looser education schema for updates to allow optional/empty startYear values
const EducationSchemaUpdate = EducationSchema.extend({
    startYear: z.preprocess((val) => {
        if (val === '' || val === null || typeof val === 'undefined') return undefined;
        if (typeof val === 'string') {
            const n = parseInt(val, 10);
            return Number.isNaN(n) ? val : n;
        }
        return val;
    }, z.number().int().min(1900).max(9999)).optional(),
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
    education: z.array(EducationSchemaUpdate).optional(),
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
        const { summary, language } = parsed;
        
        // Always detect language from input text
        let effectiveLanguage = 'en'; // default fallback
        try {
            const detected = await detectLanguage(summary);
            if (detected?.code) {
                effectiveLanguage = detected.code;
                console.log(`Detected language for summary: ${detected.code} (${detected.name})`);
            }
        } catch (error) {
            console.warn('Language detection failed for summary, using English:', error);
        }
        
        const languageConfig = getLanguageConfig(effectiveLanguage);
        const languageInfo = getLanguageInfo(effectiveLanguage);

        const prompt = `Enhance the following professional summary to be more impactful, ATS-friendly, and compelling. Keep it concise (2-3 sentences) and professional. ${languageInfo.instruction} Original summary: ${summary}`;

        // Create language-appropriate fallback content
        const fallbackContent = effectiveLanguage === 'es' 
            ? "Un profesional dedicado y versátil con una sólida base en su campo. Historial comprobado de entregar resultados y adaptarse a nuevos desafíos. Comprometido con el aprendizaje continuo y el crecimiento profesional."
            : effectiveLanguage === 'fr'
            ? "Un professionnel dévoué et polyvalent avec une solide base dans son domaine. Antécédents prouvés de livrer des résultats et s'adapter aux nouveaux défis. Engagé dans l'apprentissage continu et la croissance professionnelle."
            : "A dedicated and versatile professional with a strong foundation in their field. Proven track record of delivering results and adapting to new challenges. Committed to continuous learning and professional growth.";

        const enhancedSummary = await enhanceWithOpenAI(
            prompt,
            languageConfig.systemMessage,
            fallbackContent
        );

        // Parse the JSON response and extract just the summary text
        let finalSummary = enhancedSummary;
        try {
            const parsed = JSON.parse(enhancedSummary);
            if (parsed.professional_summary) {
                finalSummary = parsed.professional_summary;
            } else if (parsed.enhanced_summary) {
                finalSummary = parsed.enhanced_summary;
            } else if (parsed.summary) {
                finalSummary = parsed.summary;
            } else if (typeof parsed === 'string') {
                finalSummary = parsed;
            }
        } catch (error) {
            // If it's not JSON, use the raw response
            finalSummary = enhancedSummary;
        }

        return res.json({ summary: finalSummary });
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// POST /api/resumes/enhance-description
router.post('/enhance-description', asyncHandler(async (req: any, res) => {
    try {
        const parsed = EnhanceDescriptionSchema.parse(req.body);
        const { jobTitle, description, language } = parsed;
        
        // Always detect language from input text
        let effectiveLanguage = 'en'; // default fallback
        try {
            const detected = await detectLanguage(description);
            if (detected?.code) {
                effectiveLanguage = detected.code;
                console.log(`Detected language for description: ${detected.code} (${detected.name})`);
            }
        } catch (error) {
            console.warn('Language detection failed for description, using English:', error);
        }
        
        const languageConfig = getLanguageConfig(effectiveLanguage);
        const languageInfo = getLanguageInfo(effectiveLanguage);

        const prompt = `Enhance the following job description for a ${jobTitle} position. Make it more impactful with action verbs, quantifiable achievements, and ATS-friendly keywords. Return as bullet points with •. Format with single line breaks between bullet points, no extra spacing. ${languageInfo.instruction} Original: ${description}`;

        // Create language-appropriate fallback content
        const fallbackContent = effectiveLanguage === 'es' 
            ? `• Ejecutó responsabilidades principales como ${jobTitle}, mejorando la productividad del equipo y los resultados del proyecto.\n• Colaboró con partes interesadas para lograr objetivos organizacionales, aprovechando habilidades de experiencia previa.\n• Contribuyó a iniciativas clave, adaptándose a entornos de trabajo dinámicos`
            : effectiveLanguage === 'fr'
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
        const languageProvided = Object.prototype.hasOwnProperty.call(req.body, 'language');
        const normalizedLanguage = normalizeLanguageCode(typeof language === 'string' ? language : undefined);
        const validatedData = ResumeSchema.parse({ ...resumeData, language: normalizedLanguage });

        // Check if user is premium, if not restrict to basic template
        const isPremium = req.user?.isPremium || false;
        const finalTemplate = isPremium ? template : 'modern';

        // Clean descriptions first (before translation) to avoid translating duplicated companyDescription text
        const preparedData: ResumeSchemaInput = {
            ...validatedData,
            workExperience: (validatedData.workExperience || []).map((exp: any) => ({
                ...exp,
                description: (() => {
                    const cd = (exp.companyDescription || '').toString().trim();
                    if (!cd) return exp.description;
                    try {
                        const re = new RegExp(cd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
                        return (exp.description || '')
                            .replace(re, '')
                            .replace(/\s{2,}/g, ' ')
                            .replace(/^\s*[•\-|:]+\s*/, '')
                            .trim();
                    } catch (_) {
                        return exp.description;
                    }
                })(),
            })),
        };

        // Translate content when user explicitly requests a resume language
        const outputData = languageProvided
            ? await translateResumeContent(preparedData, normalizedLanguage)
            : preparedData;

        // Ensure skills are properly formatted for PDF template
        const pdfData = {
            ...outputData,
            skills: outputData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            workExperience: (outputData.workExperience || []).map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            })),
        };

        // Generate PDF using template without saving to database
        const generateResume = require('../templates');
        const doc = generateResume(pdfData, finalTemplate, normalizedLanguage);

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
        const normalizedLanguage = normalizeLanguageCode(typeof language === 'string' ? language : undefined);
        const validatedData = ResumeSchema.parse({ ...resumeData, language: normalizedLanguage });

        const resumeContent = req.body.language
            ? await translateResumeContent(validatedData, normalizedLanguage)
            : (validatedData.language === normalizedLanguage
                ? validatedData
                : { ...validatedData, language: normalizedLanguage });

        // Convert validated (and possibly translated) data to HTML format
        const htmlResumeData = {
            fullName: resumeContent.fullName,
            email: resumeContent.email,
            phone: resumeContent.phone || undefined,
            address: resumeContent.address || undefined,
            linkedIn: resumeContent.linkedIn || undefined,
            website: resumeContent.website || undefined,
            summary: resumeContent.summary || '',
            workExperience: (resumeContent.workExperience || []).map((exp) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description || '',
                companyDescription: exp.companyDescription || undefined,
                techStack: (exp as any).techStack,
            })),
            education: (resumeContent.education || []).map((edu) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })),
            skills: resumeContent.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: resumeContent.languages || [],
            certifications: (resumeContent.certifications || []).map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })),
        };

        // Determine effective language: prefer provided, else detect from content
        let effectiveLanguage = (resumeContent.language || normalizedLanguage || 'en').toLowerCase();
        if (!req.body.language) {
            try {
                const basis = (resumeContent.summary || '') || (resumeContent.workExperience?.[0]?.description || '');
                if (basis) {
                    const detected = await detectLanguage(basis);
                    if (detected?.code && detected.code !== 'und') {
                        effectiveLanguage = detected.code.toLowerCase();
                    }
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
        const languageProvided = Object.prototype.hasOwnProperty.call(req.body, 'language');
        const normalizedLanguage = normalizeLanguageCode(typeof language === 'string' ? language : undefined);
        const validatedData = ResumeSchema.parse({ ...resumeData, language: normalizedLanguage });

        const resume = await createResume({
            ...validatedData,
            education: (validatedData.education || []).map((edu: any) => ({
                ...edu,
                startYear: edu?.startYear ?? undefined,
            })),
            userId
        } as ResumeData);

        // Check if user is premium, if not restrict to basic template
        const isPremium = req.user?.isPremium || false;
        const finalTemplate = isPremium ? template : 'modern';

        const outputData = languageProvided
            ? await translateResumeContent(validatedData, normalizedLanguage)
            : validatedData;

        // Ensure skills are properly formatted for PDF template
        const pdfData = {
            ...outputData,
            skills: outputData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            workExperience: (outputData.workExperience || []).map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            })),
        };

        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(pdfData, finalTemplate, normalizedLanguage);

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
        const languageProvided = typeof req.query.language === 'string' && req.query.language.trim().length > 0;
        const normalizedLanguage = normalizeLanguageCode(languageProvided ? (req.query.language as string) : undefined);

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

        const schemaLike = mapDbResumeToSchemaInput(resume, normalizedLanguage || 'en');
        const outputData = languageProvided
            ? await translateResumeContent(schemaLike, normalizedLanguage)
            : schemaLike;

        // Build data in the shape expected by templates
        const pdfData = {
            fullName: outputData.fullName,
            email: outputData.email,
            phone: outputData.phone || undefined,
            address: outputData.address || undefined,
            linkedIn: outputData.linkedIn || undefined,
            website: outputData.website || undefined,
            summary: outputData.summary || '',
            workExperience: (outputData.workExperience || []).map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            })),
            education: (outputData.education || []).map((edu: any) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: outputData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })) || [],
        };

        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(pdfData, finalTemplate, (normalizedLanguage || (language as string)) as string);

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
            education: (validatedData.education || []).map((edu: any) => ({
                ...edu,
                startYear: edu?.startYear ?? undefined,
            })),
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

        const skillsProvided = Object.prototype.hasOwnProperty.call(req.body, 'skills');
        const languagesProvided = Object.prototype.hasOwnProperty.call(req.body, 'languages');
        const workExperienceProvided = Object.prototype.hasOwnProperty.call(req.body, 'workExperience');
        const educationProvided = Object.prototype.hasOwnProperty.call(req.body, 'education');
        const certificationsProvided = Object.prototype.hasOwnProperty.call(req.body, 'certifications');

        // Check if resume exists and belongs to user
        const existingResume = await getResumeById(resumeId, userId);
        if (!existingResume) {
            handleNotFound(res, 'Resume');
            return;
        }

        // Process skills and languages
        const processedSkills = skillsProvided ? await processSkills(validatedData.skills) : [];
        const processedLanguages = languagesProvided ? await processLanguages(validatedData.languages) : [];

        // Handle translation when user wants to change the resume language
        // This will translate content from its detected source language to the target language specified in the request
        if (validatedData.language) {
            const targetLanguage = normalizeLanguageCode(validatedData.language);
            
            // Detect source language from the content being updated
            let sourceLanguage = 'en'; // default to English
            if (validatedData.summary) {
                try {
                    const detected = await detectLanguage(validatedData.summary);
                    sourceLanguage = detected.code;
                } catch (error) {
                    console.warn('Language detection failed, defaulting to English:', error);
                }
            } else if (validatedData.workExperience && validatedData.workExperience.length > 0) {
                try {
                    const firstExp = validatedData.workExperience[0];
                    const textToDetect = [firstExp.jobTitle, firstExp.description].filter(Boolean).join(' ');
                    if (textToDetect) {
                        const detected = await detectLanguage(textToDetect);
                        sourceLanguage = detected.code;
                    }
                } catch (error) {
                    console.warn('Language detection failed, defaulting to English:', error);
                }
            }

            // Only translate if source and target languages are different
            if (sourceLanguage !== targetLanguage) {
                console.log(`Translating resume content from ${sourceLanguage} to ${targetLanguage}`);
                console.log(`Source language detected from: ${validatedData.summary ? 'summary' : 'work experience'}`);
                
                // Fields that get translated:
                // - Summary, job titles, descriptions, degrees, certifications
                // - Skills (technical terms that might benefit from translation)
                // - Language proficiency levels (e.g., "Fluent" -> "Courant")
                
                // Fields that are preserved (typically proper nouns):
                // - Company names, institution names, issuer names
                // - Language names (e.g., "English", "French")
                
                if (validatedData.summary) {
                    validatedData.summary = await translateText(validatedData.summary, targetLanguage);
                }
                
                if (validatedData.workExperience && validatedData.workExperience.length > 0) {
                    validatedData.workExperience = await Promise.all(validatedData.workExperience.map(async (exp) => ({
                        ...exp,
                        jobTitle: exp.jobTitle ? await translateText(exp.jobTitle, targetLanguage, { preserveTerms: JOB_TITLE_PRESERVE_TERMS }) : exp.jobTitle,
                        company: exp.company, // company names typically unchanged
                        location: exp.location ? await translateText(exp.location, targetLanguage) : exp.location,
                        description: exp.description ? await translateText(exp.description, targetLanguage) : exp.description,
                    })));
                }
                
                if (validatedData.education && validatedData.education.length > 0) {
                    validatedData.education = await Promise.all(validatedData.education.map(async (edu) => ({
                        ...edu,
                        degree: edu.degree ? await translateText(edu.degree, targetLanguage) : edu.degree,
                        major: edu.major ? await translateText(edu.major, targetLanguage) : edu.major,
                        institution: edu.institution, // proper noun
                        description: edu.description ? await translateText(edu.description, targetLanguage) : edu.description,
                    })));
                }
                
                if (validatedData.certifications && validatedData.certifications.length > 0) {
                    validatedData.certifications = await Promise.all(validatedData.certifications.map(async (cert) => ({
                        ...cert,
                        name: cert.name ? await translateText(cert.name, targetLanguage) : cert.name,
                        issuer: cert.issuer, // proper noun
                    })));
                }
                
                // Translate skills (technical terms, but some might benefit from translation)
                if (validatedData.skills && validatedData.skills.length > 0) {
                    validatedData.skills = await Promise.all(validatedData.skills.map(async (skill) => ({
                        ...skill,
                        name: skill.name ? await translateText(skill.name, targetLanguage) : skill.name,
                    })));
                }
                
                // Translate language proficiency levels
                if (validatedData.languages && validatedData.languages.length > 0) {
                    validatedData.languages = await Promise.all(validatedData.languages.map(async (lang) => ({
                        ...lang,
                        name: lang.name, // language names are typically kept as-is (e.g., "English", "French")
                        proficiency: lang.proficiency ? await translateText(lang.proficiency, targetLanguage) : lang.proficiency,
                    })));
                }
                
                console.log(`Translation completed for ${targetLanguage}`);
            } else {
                console.log(`No translation needed: content is already in ${targetLanguage}`);
            }
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
        if (skillsProvided) {
            updateData.skills = { 
                set: [],
                ...(processedSkills.length > 0 ? { connect: processedSkills.map((skill) => ({ id: skill.id })) } : {})
            };
        }
        
        if (languagesProvided) {
            updateData.languages = { 
                set: [],
                ...(processedLanguages.length > 0 ? { connect: processedLanguages.map((lang) => ({ id: lang.id })) } : {})
            };
        }
        
        // Update work experiences if provided
        if (workExperienceProvided) {
            updateData.workExperiences = {
                deleteMany: {},
                ...(validatedData.workExperience && validatedData.workExperience.length > 0
                    ? {
                        create: validatedData.workExperience.map((exp) => ({
                            jobTitle: exp.jobTitle,
                            company: exp.company,
                            location: exp.location,
                            startDate: new Date(exp.startDate),
                            endDate: exp.endDate && exp.endDate !== 'Present' ? new Date(exp.endDate) : null,
                            description: exp.description,
                            companyDescription: exp.companyDescription,
                            techStack: exp.techStack,
                        })),
                    }
                    : {})
            };
        }
        
        // Update educations if provided
        if (educationProvided) {
            updateData.educations = {
                deleteMany: {},
                ...(validatedData.education && validatedData.education.length > 0
                    ? {
                        create: validatedData.education.map(edu => ({
                            degree: edu.degree,
                            institution: edu.institution,
                            startYear: edu.startYear ?? undefined,
                            graduationYear: edu.graduationYear,
                            description: edu.description,
                        })),
                    }
                    : {})
            };
        }
        
        // Update certifications if provided
        if (certificationsProvided) {
            updateData.certifications = {
                deleteMany: {},
                ...(validatedData.certifications && validatedData.certifications.length > 0
                    ? {
                        create: validatedData.certifications.map((cert) => ({
                            name: cert.name,
                            issuer: cert.issuer,
                            issueDate: cert.issueDate ? new Date(cert.issueDate) : null,
                        })),
                    }
                    : {})
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

// Dashboard stats endpoint
router.get('/dashboard/stats', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    
    try {
        // Get resume count
        const resumeCount = await prisma.resume.count({
            where: { userId }
        });
        
        // Get cover letter count
        const coverLetterCount = await prisma.coverLetter.count({
            where: { userId }
        });
        
        // Get job tracking stats
        const jobs = await prisma.job.findMany({
            where: { userId },
            select: { status: true }
        });
        
        const totalJobs = jobs.length;
        const appliedJobs = jobs.filter((job: any) => job.status === 'applied').length;
        const interviewingJobs = jobs.filter((job: any) => job.status === 'interviewing').length;
        const rejectedJobs = jobs.filter((job: any) => job.status === 'rejected').length;
        const offerJobs = jobs.filter((job: any) => job.status === 'offer').length;
        const withdrawnJobs = jobs.filter((job: any) => job.status === 'withdrawn').length;
        const pendingJobs = jobs.filter((job: any) => job.status === 'pending').length;
        const followUpJobs = jobs.filter((job: any) => job.status === 'follow-up').length;
        
        // Calculate response rate
        const responseCounts = interviewingJobs + offerJobs + pendingJobs + followUpJobs;
        const responseRate = totalJobs > 0 ? Math.round((responseCounts / totalJobs) * 100) : 0;
        const interviewRate = totalJobs > 0 ? Math.round((interviewingJobs / totalJobs) * 100) : 0;
        const offerRate = totalJobs > 0 ? Math.round((offerJobs / totalJobs) * 100) : 0;
        
        // Get user subscription status
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                planType: true,
                subscriptionStatus: true,
                subscriptionEnd: true
            }
        });
        
        const isPremium = Boolean(user?.planType === 'premium' && 
                         user.subscriptionStatus === 'active' &&
                         user.subscriptionEnd && 
                         new Date(user.subscriptionEnd) > new Date());
        
        const dashboardStats = {
            user: {
                isPremium,
                planType: user?.planType || 'free',
                subscriptionStatus: user?.subscriptionStatus || 'none'
            },
            resumes: {
                total: resumeCount
            },
            coverLetters: {
                total: coverLetterCount
            },
            jobTracking: {
                total: totalJobs,
                byStatus: {
                    applied: appliedJobs,
                    interviewing: interviewingJobs,
                    rejected: rejectedJobs,
                    offer: offerJobs,
                    withdrawn: withdrawnJobs,
                    pending: pendingJobs,
                    followUp: followUpJobs
                },
                metrics: {
                    responseRate,
                    interviewRate,
                    offerRate
                }
            }
        };
        
        res.json(dashboardStats);
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
}));

// POST /api/resumes/:id/pdf
router.post('/:id/pdf', ensureAuthenticated, withPremiumFeatures, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'modern', language: reqLanguage } = req.body;
        const languageProvided = typeof reqLanguage === 'string' && reqLanguage.trim().length > 0;
        const normalizedLanguage = normalizeLanguageCode(languageProvided ? (reqLanguage as string) : undefined);

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

        const schemaLike = mapDbResumeToSchemaInput(resume, normalizedLanguage || 'en');
        const outputData = languageProvided
            ? await translateResumeContent(schemaLike, normalizedLanguage)
            : schemaLike;

        // Convert resume data to PDF format
        const pdfData = {
            fullName: outputData.fullName,
            email: outputData.email,
            phone: outputData.phone || undefined,
            address: outputData.address || undefined,
            linkedIn: outputData.linkedIn || undefined,
            website: outputData.website || undefined,
            summary: outputData.summary || '',
            workExperience: (outputData.workExperience || []).map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            })) || [],
            education: (outputData.education || []).map((edu: any) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: outputData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })) || [],
        };

        // Generate PDF using template
        // Determine language: use provided or detect from content
        let effectiveLanguage = languageProvided ? normalizedLanguage : 'en';
        try {
            if (!languageProvided) {
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
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
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

        const prompt: string = `You are an expert resume strategist and professional writer. Your task is to rewrite the provided resume to specifically target the Job Description (JD) provided.

OBJECTIVE:
Create a "tailored" version of this resume that scores highly on ATS (Applicant Tracking Systems) and appeals to human recruiters for this specific role.

INSTRUCTIONS:

1.  **Professional Summary**:
    *   Rewrite the summary completely. It must be a compelling "elevator pitch" that directly addresses the core requirements in the JD.
    *   Incorporate the exact job title from the JD if applicable.
    *   Highlight the most relevant years of experience and key achievements that match the JD.

2.  **Skills Section**:
    *   Integrate the "Matched Skills" listed below.
    *   Organize skills logically.
    *   Ensure high-priority keywords from the JD are present.

3.  **Work Experience**:
    *   **Reorder & Prioritize**: For each role, reorder bullet points so the most relevant experience for *this* JD comes first.
    *   **Keyword Integration**: Rewrite bullet points to naturally include keywords and phrases from the JD (e.g., if JD asks for "cross-functional collaboration", rephrase a relevant bullet to use that term).
    *   **Action & Impact**: Start every bullet with a strong action verb. Focus on *achievements* and *results* (quantified if possible) rather than just responsibilities.
    *   **Relevance**: Condense or remove bullet points that are completely irrelevant to the target role to keep the resume focused.
    *   **Tech Stack**: Update the \`techStack\` field to list relevant technologies used in that role, prioritizing those mentioned in the JD.

4.  **General Tone**:
    *   Use professional, active, and confident language.
    *   Maintain truthfulness—do not invent experiences, but frame existing ones in the most relevant light.

${languageInfo.instruction}

IMPORTANT FORMATTING:
*   Work experience descriptions MUST be a single string with bullet points using '•'.
*   techStack in workExperience should be a comma-separated string (e.g. "React, Node.js, TypeScript").
*   Return ONLY the JSON object.

Matched Skills to Include:
${uniqueSkills.map(skill => skill.name).join(', ')}

Job Description:
${jobDescription}

Original Resume:
${JSON.stringify(resumeData, null, 2)}

Return the enhanced resume as structured JSON matching this format:
{
  "fullName": "...",
  "email": "...",
  "phone": "...",
  "address": "...",
  "linkedIn": "...",
  "website": "...",
  "summary": "...",
  "skills": [{ "name": "..." }],
  "languages": [{ "name": "...", "proficiency": "..." }],
  "workExperience": [{ "jobTitle": "...", "company": "...", "location": "...", "startDate": "...", "endDate": "...", "description": "...", "companyDescription": "...", "techStack": "..." }],
  "education": [{ "degree": "...", "major": "...", "institution": "...", "graduationYear": "...", "gpa": "...", "description": "..." }],
  "certifications": [{ "name": "...", "issuer": "...", "issueDate": "..." }]
}
`;

        // Call OpenAI to enhance the resume
        let enhancedResume = null;
        const maxRetries = 2;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await openai.chat.completions.create({
                    model: 'gpt-5.2',
                    messages: [
                        { role: 'system', content: languageConfig.systemMessage },
                        { role: 'user', content: prompt },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.5,
                    max_completion_tokens: 2500,
                });

                const content = response.choices[0]?.message?.content?.trim();
                if (content) {
                    enhancedResume = tryParseJsonObject(content);
                    if (enhancedResume) break;
                    console.warn(`JSON parse error on attempt ${attempt}: unable to parse model output as JSON object`);
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

        // Be tolerant to slight key name variations from the model
        const finalWorkExperience = (enhancedResume as any).workExperience || (enhancedResume as any).workExperiences || [];
        const finalEducation = (enhancedResume as any).education || (enhancedResume as any).educations || [];
        const finalCertifications = (enhancedResume as any).certifications || [];

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
                    create: (finalWorkExperience || []).map((exp: any) => ({
                        jobTitle: exp.jobTitle,
                        company: exp.company,
                        location: exp.location,
                        startDate: new Date(exp.startDate),
                        endDate: exp.endDate && exp.endDate !== 'Present' ? new Date(exp.endDate) : null,
                        description: exp.description,
                        companyDescription: exp.companyDescription,
                        techStack: exp.techStack,
                    })),
                },
                educations: {
                    create: (finalEducation || []).map((edu: any) => ({
                        degree: edu.degree,
                        major: edu.major,
                        institution: edu.institution,
                        startYear: edu.startYear,
                        graduationYear: edu.graduationYear,
                        gpa: edu.gpa,
                        description: edu.description,
                    })),
                },
                certifications: {
                    create: (finalCertifications || []).map((cert: any) => ({
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
        const languageProvided = typeof req.query.language === 'string' && req.query.language.trim().length > 0;
        const normalizedLanguage = normalizeLanguageCode(languageProvided ? (req.query.language as string) : undefined);

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

        const schemaLike = mapDbResumeToSchemaInput(resume, normalizedLanguage || 'en');
        const outputData = languageProvided
            ? await translateResumeContent(schemaLike, normalizedLanguage)
            : schemaLike;

        // Convert resume data to HTML format
        const resumeData = {
            fullName: outputData.fullName,
            email: outputData.email,
            phone: outputData.phone || undefined,
            address: outputData.address || undefined,
            linkedIn: outputData.linkedIn || undefined,
            website: outputData.website || undefined,
            summary: outputData.summary || '',
            workExperience: (outputData.workExperience || []).map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription || undefined,
                techStack: exp.techStack,
            })) || [],
            education: (outputData.education || []).map((edu: any) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: outputData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })) || [],
        };

        // Determine effective language for preview: prefer query param, else detect
        let effectiveLanguage = languageProvided ? normalizedLanguage : 'en';
        if (!languageProvided) {
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
        const languageProvided = Object.prototype.hasOwnProperty.call(req.body, 'language');
        const normalizedLanguage = normalizeLanguageCode(typeof language === 'string' ? language : undefined);
        const validatedData = ResumeSchema.parse({ ...resumeData, language: normalizedLanguage });

        // Save the resume to database first
        const resume = await createResume({
            ...validatedData,
            education: (validatedData.education || []).map((edu: any) => ({
                ...edu,
                startYear: edu?.startYear ?? undefined,
            })),
            userId
        } as ResumeData);

        const outputData = languageProvided
            ? await translateResumeContent(validatedData, normalizedLanguage)
            : validatedData;

        // Convert resume data to HTML format
        const htmlResumeData = {
            fullName: outputData.fullName,
            email: outputData.email,
            phone: outputData.phone || undefined,
            address: outputData.address || undefined,
            linkedIn: outputData.linkedIn || undefined,
            website: outputData.website || undefined,
            summary: outputData.summary || '',
            workExperience: (outputData.workExperience || []).map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: (exp as any).companyDescription || undefined,
                techStack: (exp as any).techStack,
            })),
            education: (outputData.education || []).map((edu: any) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })),
            skills: outputData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })) || [],
        };

        // Generate HTML
        // Determine effective language: prefer provided, else detect from summary/experience
        let effectiveLanguage = languageProvided ? normalizedLanguage : 'en';
        if (!languageProvided) {
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
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--font-render-hinting=none'
            ]
        };
        if (executablePath) launchOptions.executablePath = executablePath;
        
        console.log('Launching Puppeteer with options:', JSON.stringify({ ...launchOptions, executablePath: 'REDACTED' }));
        
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
        console.error('PDF Generation Error:', error);
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
        const languageProvided = Object.prototype.hasOwnProperty.call(req.body, 'language')
            && typeof req.body.language === 'string'
            && req.body.language.trim().length > 0;
        const normalizedLanguage = normalizeLanguageCode(typeof language === 'string' ? language : undefined);

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

        const schemaLike = mapDbResumeToSchemaInput(resume, normalizedLanguage || 'en');
        const outputData = languageProvided
            ? await translateResumeContent(schemaLike, normalizedLanguage)
            : schemaLike;

        // Convert resume data to HTML format
        const resumeData = {
            fullName: outputData.fullName,
            email: outputData.email,
            phone: outputData.phone || undefined,
            address: outputData.address || undefined,
            linkedIn: outputData.linkedIn || undefined,
            website: outputData.website || undefined,
            summary: outputData.summary || '',
            workExperience: (outputData.workExperience || []).map((exp: any) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            })),
            education: (outputData.education || []).map((edu: any) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: outputData.skills?.map((skill: any) => ({ name: skill.name })) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert: any) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })) || [],
        };

        // Generate HTML
        // Determine effective language: prefer provided, else detect from saved content
        let effectiveLanguage = languageProvided ? normalizedLanguage : 'en';
        if (!languageProvided) {
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
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--font-render-hinting=none'
            ]
        };
        if (executablePath) launchOptions2.executablePath = executablePath;
        
        console.log('Launching Puppeteer (HTML-PDF) with options:', JSON.stringify({ ...launchOptions2, executablePath: 'REDACTED' }));

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
        // Include error message in response for better debugging in prod
        res.status(500).json({
            error: 'Failed to generate HTML PDF',
            details: error instanceof Error ? error.message : String(error)
        });
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

function tryParseJsonObject(content: string): Record<string, any> | null {
    if (!content || typeof content !== 'string') return null;
    const raw = content.trim();
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}

    const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        try {
            const parsed = JSON.parse(fenced[1]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {}
    }

    const objMatch = raw.match(/(\{[\s\S]*\})/);
    if (objMatch?.[1]) {
        try {
            const parsed = JSON.parse(objMatch[1]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {}
    }
    return null;
}

function tryParseJsonStringArray(content: string): string[] | null {
    if (!content || typeof content !== 'string') return null;
    const raw = content.trim();
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string');
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).skills)) {
            return (parsed as any).skills.filter((v: any) => typeof v === 'string');
        }
    } catch {}

    const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        return tryParseJsonStringArray(fenced[1]);
    }

    const arrMatch = raw.match(/(\[[\s\S]*\])/);
    if (arrMatch?.[1]) {
        try {
            const parsed = JSON.parse(arrMatch[1]);
            if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string');
        } catch {}
    }
    return null;
}

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

Return ONLY valid JSON as an object in this exact shape:
{"skills": ["..."]}

Job Description:
${jobDescription}`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-5.2',
            messages: [
                { role: 'system', content: languageConfig.systemMessage },
                { role: 'user', content: extractionPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_completion_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) {
            return [];
        }

        const extractedSkills = tryParseJsonStringArray(content);
        if (!extractedSkills) {
            console.warn('Failed to parse extracted skills: model did not return a valid JSON array of strings');
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

Return ONLY valid JSON as an object in this exact shape:
{"skills": ["..."]}

Job Description:
${jobDescription}`;

        const additionalResponse = await openai.chat.completions.create({
            model: 'gpt-5.2',
            messages: [
                { role: 'system', content: languageConfig.systemMessage },
                { role: 'user', content: additionalSkillsPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.5,
            max_completion_tokens: 500,
        });

        const additionalContent = additionalResponse.choices[0]?.message?.content?.trim();
        if (additionalContent) {
            const additionalSkills = tryParseJsonStringArray(additionalContent);
            if (additionalSkills) {
                newSkills.push(...additionalSkills);
            } else {
                console.warn('Failed to parse additional skills: model did not return a valid JSON array of strings');
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
