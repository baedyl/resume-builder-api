"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const asyncHandler_1 = require("../utils/asyncHandler");
const multer_1 = __importDefault(require("multer"));
// Import shared utilities and services
const database_1 = require("../lib/database");
const openai_1 = require("../lib/openai");
const validation_1 = require("../utils/validation");
const language_1 = require("../utils/language");
const openai_2 = require("../utils/openai");
const openai_3 = require("../utils/openai");
const errorHandling_1 = require("../utils/errorHandling");
const resumeService_1 = require("../services/resumeService");
const htmlResumeService_1 = require("../services/htmlResumeService");
const subscription_1 = require("../middleware/subscription");
const router = express_1.default.Router();
// Preserve these tokens/terms in job titles when translating (e.g., "Senior Data Consultant" -> "Consultant Senior Data").
const JOB_TITLE_PRESERVE_TERMS = ['Data'];
async function resolveChromeExecutablePath(puppeteer) {
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
    }
    catch (e) {
        console.warn('puppeteer.executablePath() failed:', e);
    }
    // 3. Fallback: Try common Render/cloud cache locations
    try {
        const path = require('path');
        const candidateCacheRoots = [
            process.env.PUPPETEER_CACHE_DIR,
            path.join(process.cwd(), '.cache', 'puppeteer'),
            '/opt/render/.cache/puppeteer',
            '/opt/render/project/.cache/puppeteer',
            process.env.HOME ? `${process.env.HOME}/.cache/puppeteer` : undefined,
            '/root/.cache/puppeteer'
        ].filter(Boolean);
        console.log('Searching for Chrome in cache roots:', candidateCacheRoots);
        for (const cacheDir of candidateCacheRoots) {
            if (!fs.existsSync(cacheDir))
                continue;
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
    }
    catch (e) {
        console.warn('Manual cache search failed:', e);
    }
    console.warn('Could not resolve Chrome executable path');
    return undefined;
}
// Helper to send PDFKit documents reliably by buffering and setting Content-Length
function sendPdfDocument(res, doc, filename) {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
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
        }
        else {
            try {
                res.end();
            }
            catch (_) { /* noop */ }
        }
    });
    doc.end();
}
// Enhanced schemas using shared components
const ResumeSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    fullName: zod_1.z.string().min(1, 'Full name is required'),
    email: zod_1.z.string().email('Invalid email'),
    phone: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
    linkedIn: zod_1.z.string().optional(),
    website: zod_1.z.string().optional(),
    summary: zod_1.z.string().optional(),
    skills: zod_1.z.array(validation_1.SkillSchema).default([]),
    workExperience: zod_1.z.array(validation_1.WorkExperienceSchema).min(1, 'At least one work experience is required'),
    education: zod_1.z.array(validation_1.EducationSchema).min(1, 'At least one education entry is required'),
    languages: zod_1.z.array(validation_1.LanguageSchema).default([]),
    certifications: zod_1.z.array(validation_1.CertificationSchema).default([]),
    language: zod_1.z.string().optional().default('en'), // Add language parameter
});
async function translateResumeContent(data, targetLanguage) {
    var _a, _b, _c, _d;
    const normalizedTarget = (0, language_1.normalizeLanguageCode)(targetLanguage);
    const detectionCandidates = [
        data.summary,
        (_b = (_a = data.workExperience) === null || _a === void 0 ? void 0 : _a.find((exp) => exp.description)) === null || _b === void 0 ? void 0 : _b.description,
        (_d = (_c = data.education) === null || _c === void 0 ? void 0 : _c.find((edu) => edu.description)) === null || _d === void 0 ? void 0 : _d.description
    ].filter((value) => typeof value === 'string' && value.trim().length > 0);
    let sourceLanguage = 'en';
    for (const candidate of detectionCandidates) {
        try {
            const detected = await (0, language_1.detectLanguage)(candidate);
            if ((detected === null || detected === void 0 ? void 0 : detected.code) && detected.code !== 'und') {
                sourceLanguage = detected.code.toLowerCase();
                break;
            }
        }
        catch (_e) {
            // ignore detection errors and continue with default sourceLanguage
        }
    }
    if (sourceLanguage === normalizedTarget) {
        return {
            ...data,
            language: normalizedTarget,
        };
    }
    const translateField = async (text) => {
        if (text === null || typeof text === 'undefined')
            return text !== null && text !== void 0 ? text : undefined;
        const trimmed = text.toString().trim();
        if (trimmed.length === 0)
            return text !== null && text !== void 0 ? text : undefined;
        return await (0, openai_2.translateText)(trimmed, normalizedTarget);
    };
    const translateJobTitleField = async (text) => {
        if (text === null || typeof text === 'undefined')
            return text !== null && text !== void 0 ? text : undefined;
        const trimmed = text.toString().trim();
        if (trimmed.length === 0)
            return text !== null && text !== void 0 ? text : undefined;
        return await (0, openai_2.translateText)(trimmed, normalizedTarget, { preserveTerms: JOB_TITLE_PRESERVE_TERMS });
    };
    const translatedSummary = await translateField(data.summary);
    const translatedWorkExperience = await Promise.all((data.workExperience || []).map(async (exp) => {
        var _a, _b, _c, _d;
        return ({
            ...exp,
            jobTitle: (_a = (await translateJobTitleField(exp.jobTitle))) !== null && _a !== void 0 ? _a : exp.jobTitle,
            company: exp.company,
            location: (_b = (await translateField(exp.location))) !== null && _b !== void 0 ? _b : exp.location,
            description: (_c = (await translateField(exp.description))) !== null && _c !== void 0 ? _c : exp.description,
            companyDescription: (_d = (await translateField(exp.companyDescription))) !== null && _d !== void 0 ? _d : exp.companyDescription,
        });
    }));
    const translatedEducation = await Promise.all((data.education || []).map(async (edu) => {
        var _a, _b, _c, _d;
        return ({
            ...edu,
            degree: (_a = (await translateField(edu.degree))) !== null && _a !== void 0 ? _a : edu.degree,
            major: (_b = (await translateField(edu.major))) !== null && _b !== void 0 ? _b : edu.major,
            institution: (_c = (await translateField(edu.institution))) !== null && _c !== void 0 ? _c : edu.institution,
            description: (_d = (await translateField(edu.description))) !== null && _d !== void 0 ? _d : edu.description,
        });
    }));
    const translatedCertifications = await Promise.all((data.certifications || []).map(async (cert) => {
        var _a;
        return ({
            ...cert,
            name: (_a = (await translateField(cert.name))) !== null && _a !== void 0 ? _a : cert.name,
            issuer: cert.issuer,
        });
    }));
    const translatedSkills = await Promise.all((data.skills || []).map(async (skill) => {
        var _a;
        return ({
            ...skill,
            name: (_a = (await translateField(skill.name))) !== null && _a !== void 0 ? _a : skill.name,
        });
    }));
    return {
        ...data,
        language: normalizedTarget,
        summary: translatedSummary !== null && translatedSummary !== void 0 ? translatedSummary : undefined,
        workExperience: translatedWorkExperience,
        education: translatedEducation,
        certifications: translatedCertifications,
        skills: translatedSkills,
    };
}
function mapDbResumeToSchemaInput(resume, language) {
    return {
        fullName: resume.fullName,
        email: resume.email,
        phone: resume.phone || undefined,
        address: resume.address || undefined,
        linkedIn: resume.linkedIn || undefined,
        website: resume.website || undefined,
        summary: resume.summary || undefined,
        skills: (resume.skills || []).map((s) => ({ name: s.name })),
        workExperience: (resume.workExperiences || []).map((exp) => ({
            jobTitle: exp.jobTitle,
            company: exp.company,
            location: exp.location,
            startDate: exp.startDate,
            endDate: exp.endDate,
            description: exp.description,
            companyDescription: exp.companyDescription,
            techStack: exp.techStack,
        })),
        education: (resume.educations || []).map((edu) => ({
            degree: edu.degree,
            major: edu.major,
            institution: edu.institution,
            startYear: edu.startYear,
            graduationYear: edu.graduationYear,
            gpa: edu.gpa,
            description: edu.description,
        })),
        certifications: (resume.certifications || []).map((cert) => ({
            name: cert.name,
            issuer: cert.issuer,
            issueDate: cert.issueDate,
        })),
        languages: resume.languages || [],
        language,
    };
}
// Looser education schema for updates to allow optional/empty startYear values
const EducationSchemaUpdate = validation_1.EducationSchema.extend({
    startYear: zod_1.z.preprocess((val) => {
        if (val === '' || val === null || typeof val === 'undefined')
            return undefined;
        if (typeof val === 'string') {
            const n = parseInt(val, 10);
            return Number.isNaN(n) ? val : n;
        }
        return val;
    }, zod_1.z.number().int().min(1900).max(9999)).optional(),
});
const ResumeUpdateSchema = zod_1.z.object({
    fullName: zod_1.z.string().min(1, 'Full name is required').optional(),
    email: zod_1.z.string().email('Invalid email').optional(),
    phone: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
    linkedIn: zod_1.z.string().optional(),
    website: zod_1.z.string().optional(),
    summary: zod_1.z.string().optional(),
    skills: zod_1.z.array(validation_1.SkillSchema).default([]),
    workExperience: zod_1.z.array(validation_1.WorkExperienceSchema).optional(),
    education: zod_1.z.array(EducationSchemaUpdate).optional(),
    languages: zod_1.z.array(validation_1.LanguageSchema).default([]),
    certifications: zod_1.z.array(validation_1.CertificationSchema).default([]),
    language: zod_1.z.string().optional(), // Add language parameter
});
const EnhanceDescriptionSchema = zod_1.z.object({
    jobTitle: zod_1.z.string().min(1, 'Job title is required'),
    description: zod_1.z.string().min(1, 'Description is required'),
    language: zod_1.z.string().optional().default('en'), // Add language parameter
});
const EnhanceSummarySchema = zod_1.z.object({
    summary: zod_1.z.string().min(1, 'Summary is required'),
    language: zod_1.z.string().optional().default('en'), // Add language parameter
});
// Multer configuration
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, callback) => {
        if (file.mimetype === 'application/pdf' ||
            file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.mimetype === 'application/msword') {
            callback(null, true);
        }
        else {
            callback(new Error('Only PDF and Word documents are allowed'));
        }
    },
});
// POST /api/resumes/enhance-summary
router.post('/enhance-summary', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    try {
        const parsed = EnhanceSummarySchema.parse(req.body);
        const { summary, language } = parsed;
        // Always detect language from input text
        let effectiveLanguage = 'en'; // default fallback
        try {
            const detected = await (0, language_1.detectLanguage)(summary);
            if (detected === null || detected === void 0 ? void 0 : detected.code) {
                effectiveLanguage = detected.code;
                console.log(`Detected language for summary: ${detected.code} (${detected.name})`);
            }
        }
        catch (error) {
            console.warn('Language detection failed for summary, using English:', error);
        }
        const languageConfig = (0, language_1.getLanguageConfig)(effectiveLanguage);
        const languageInfo = (0, language_1.getLanguageInfo)(effectiveLanguage);
        const prompt = `Enhance the following professional summary to be more impactful, ATS-friendly, and compelling. Keep it concise (2-3 sentences) and professional. ${languageInfo.instruction} Original summary: ${summary}`;
        // Create language-appropriate fallback content
        const fallbackContent = effectiveLanguage === 'es'
            ? "Un profesional dedicado y versátil con una sólida base en su campo. Historial comprobado de entregar resultados y adaptarse a nuevos desafíos. Comprometido con el aprendizaje continuo y el crecimiento profesional."
            : effectiveLanguage === 'fr'
                ? "Un professionnel dévoué et polyvalent avec une solide base dans son domaine. Antécédents prouvés de livrer des résultats et s'adapter aux nouveaux défis. Engagé dans l'apprentissage continu et la croissance professionnelle."
                : "A dedicated and versatile professional with a strong foundation in their field. Proven track record of delivering results and adapting to new challenges. Committed to continuous learning and professional growth.";
        const enhancedSummary = await (0, openai_3.enhanceWithOpenAI)(prompt, languageConfig.systemMessage, fallbackContent);
        // Parse the JSON response and extract just the summary text
        let finalSummary = enhancedSummary;
        try {
            const parsed = JSON.parse(enhancedSummary);
            if (parsed.professional_summary) {
                finalSummary = parsed.professional_summary;
            }
            else if (parsed.enhanced_summary) {
                finalSummary = parsed.enhanced_summary;
            }
            else if (parsed.summary) {
                finalSummary = parsed.summary;
            }
            else if (typeof parsed === 'string') {
                finalSummary = parsed;
            }
        }
        catch (error) {
            // If it's not JSON, use the raw response
            finalSummary = enhancedSummary;
        }
        return res.json({ summary: finalSummary });
    }
    catch (error) {
        (0, errorHandling_1.handleValidationError)(error, res);
    }
}));
// POST /api/resumes/enhance-description
router.post('/enhance-description', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    try {
        const parsed = EnhanceDescriptionSchema.parse(req.body);
        const { jobTitle, description, language } = parsed;
        // Always detect language from input text
        let effectiveLanguage = 'en'; // default fallback
        try {
            const detected = await (0, language_1.detectLanguage)(description);
            if (detected === null || detected === void 0 ? void 0 : detected.code) {
                effectiveLanguage = detected.code;
                console.log(`Detected language for description: ${detected.code} (${detected.name})`);
            }
        }
        catch (error) {
            console.warn('Language detection failed for description, using English:', error);
        }
        const languageConfig = (0, language_1.getLanguageConfig)(effectiveLanguage);
        const languageInfo = (0, language_1.getLanguageInfo)(effectiveLanguage);
        const prompt = `Enhance the following job description for a ${jobTitle} position. Make it more impactful with action verbs, quantifiable achievements, and ATS-friendly keywords. Return as bullet points with •. Format with single line breaks between bullet points, no extra spacing. ${languageInfo.instruction} Original: ${description}`;
        // Create language-appropriate fallback content
        const fallbackContent = effectiveLanguage === 'es'
            ? `• Ejecutó responsabilidades principales como ${jobTitle}, mejorando la productividad del equipo y los resultados del proyecto.\n• Colaboró con partes interesadas para lograr objetivos organizacionales, aprovechando habilidades de experiencia previa.\n• Contribuyó a iniciativas clave, adaptándose a entornos de trabajo dinámicos`
            : effectiveLanguage === 'fr'
                ? `• Exécuté les responsabilités principales en tant que ${jobTitle}, améliorant la productivité de l'équipe et les résultats du projet.\n• Collaboré avec les parties prenantes pour atteindre les objectifs organisationnels, en exploitant les compétences de l'expérience précédente.\n• Contribué aux initiatives clés, en s'adaptant aux environnements de travail dynamiques`
                : `• Performed core responsibilities as a ${jobTitle}, enhancing team productivity and project outcomes.\n• Collaborated with stakeholders to achieve organizational goals, leveraging skills from prior experience.\n• Contributed to key initiatives, adapting to dynamic work environments`;
        const enhancedDescription = await (0, openai_3.enhanceWithOpenAI)(prompt, languageConfig.systemMessage, fallbackContent);
        return res.json({ data: enhancedDescription });
    }
    catch (error) {
        (0, errorHandling_1.handleValidationError)(error, res);
    }
}));
// POST /api/resumes/new/pdf - Generate PDF from new resume data without saving
router.post('/new/pdf', auth_1.ensureAuthenticated, subscription_1.withPremiumFeatures, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        const { template = 'modern', language = 'en', ...resumeData } = req.body;
        const languageProvided = Object.prototype.hasOwnProperty.call(req.body, 'language');
        const normalizedLanguage = (0, language_1.normalizeLanguageCode)(typeof language === 'string' ? language : undefined);
        const validatedData = ResumeSchema.parse({ ...resumeData, language: normalizedLanguage });
        // Check if user is premium, if not restrict to basic template
        const isPremium = ((_b = req.user) === null || _b === void 0 ? void 0 : _b.isPremium) || false;
        const finalTemplate = isPremium ? template : 'modern';
        // Clean descriptions first (before translation) to avoid translating duplicated companyDescription text
        const preparedData = {
            ...validatedData,
            workExperience: (validatedData.workExperience || []).map((exp) => ({
                ...exp,
                description: (() => {
                    const cd = (exp.companyDescription || '').toString().trim();
                    if (!cd)
                        return exp.description;
                    try {
                        const re = new RegExp(cd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
                        return (exp.description || '')
                            .replace(re, '')
                            .replace(/\s{2,}/g, ' ')
                            .replace(/^\s*[•\-|:]+\s*/, '')
                            .trim();
                    }
                    catch (_) {
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
            skills: ((_c = outputData.skills) === null || _c === void 0 ? void 0 : _c.map((skill) => ({ name: skill.name }))) || [],
            workExperience: (outputData.workExperience || []).map((exp) => ({
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
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            (0, errorHandling_1.handleValidationError)(error, res);
        }
        else {
            (0, errorHandling_1.handleDatabaseError)(error, res, 'generate PDF');
        }
    }
}));
// POST /api/resumes/new/html - Generate HTML from new resume data without saving
router.post('/new/html', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c, _d;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        const { template = 'colorful', language = 'en', ...resumeData } = req.body;
        const normalizedLanguage = (0, language_1.normalizeLanguageCode)(typeof language === 'string' ? language : undefined);
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
                techStack: exp.techStack,
            })),
            education: (resumeContent.education || []).map((edu) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })),
            skills: ((_b = resumeContent.skills) === null || _b === void 0 ? void 0 : _b.map((skill) => ({ name: skill.name }))) || [],
            languages: resumeContent.languages || [],
            certifications: (resumeContent.certifications || []).map((cert) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })),
        };
        // Determine effective language: prefer provided, else detect from content
        let effectiveLanguage = (resumeContent.language || normalizedLanguage || 'en').toLowerCase();
        if (!req.body.language) {
            try {
                const basis = (resumeContent.summary || '') || (((_d = (_c = resumeContent.workExperience) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.description) || '');
                if (basis) {
                    const detected = await (0, language_1.detectLanguage)(basis);
                    if ((detected === null || detected === void 0 ? void 0 : detected.code) && detected.code !== 'und') {
                        effectiveLanguage = detected.code.toLowerCase();
                    }
                }
            }
            catch (_e) { }
        }
        const html = (0, htmlResumeService_1.generateHTMLResume)(htmlResumeData, template, effectiveLanguage);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            (0, errorHandling_1.handleValidationError)(error, res);
        }
        else {
            (0, errorHandling_1.handleDatabaseError)(error, res, 'generate HTML');
        }
    }
}));
// POST /api/resumes/save-and-pdf - Save resume and return PDF
router.post('/save-and-pdf', auth_1.ensureAuthenticated, subscription_1.withPremiumFeatures, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        const { template = 'modern', language = 'en', ...resumeData } = req.body;
        const languageProvided = Object.prototype.hasOwnProperty.call(req.body, 'language');
        const normalizedLanguage = (0, language_1.normalizeLanguageCode)(typeof language === 'string' ? language : undefined);
        const validatedData = ResumeSchema.parse({ ...resumeData, language: normalizedLanguage });
        // Check if user is premium, if not restrict to basic template
        const isPremium = ((_b = req.user) === null || _b === void 0 ? void 0 : _b.isPremium) || false;
        const finalTemplate = isPremium ? template : 'modern';
        const outputData = languageProvided
            ? await translateResumeContent(validatedData, normalizedLanguage)
            : validatedData;
        const resume = await (0, resumeService_1.createResume)({
            ...outputData,
            education: (outputData.education || []).map((edu) => {
                var _a;
                return ({
                    ...edu,
                    startYear: (_a = edu === null || edu === void 0 ? void 0 : edu.startYear) !== null && _a !== void 0 ? _a : undefined,
                });
            }),
            userId
        });
        // Ensure skills are properly formatted for PDF template
        const pdfData = {
            ...outputData,
            skills: ((_c = outputData.skills) === null || _c === void 0 ? void 0 : _c.map((skill) => ({ name: skill.name }))) || [],
            workExperience: (outputData.workExperience || []).map((exp) => ({
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
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            (0, errorHandling_1.handleValidationError)(error, res);
        }
        else {
            (0, errorHandling_1.handleDatabaseError)(error, res, 'create resume');
        }
    }
}));
// GET /api/resumes/:id/download - Download saved resume as PDF (free users allowed)
router.get('/:id/download', auth_1.ensureAuthenticated, subscription_1.withPremiumFeatures, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'modern', language = 'en' } = req.query;
        const languageProvided = typeof req.query.language === 'string' && req.query.language.trim().length > 0;
        const normalizedLanguage = (0, language_1.normalizeLanguageCode)(languageProvided ? req.query.language : undefined);
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }
        const resume = await (0, resumeService_1.getResumeById)(resumeId, userId);
        if (!resume) {
            (0, errorHandling_1.handleNotFound)(res, 'Resume');
            return;
        }
        // Check if user is premium, if not restrict to basic template
        const isPremium = ((_b = req.user) === null || _b === void 0 ? void 0 : _b.isPremium) || false;
        const finalTemplate = isPremium ? template : 'modern';
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
            workExperience: (outputData.workExperience || []).map((exp) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            })),
            education: (outputData.education || []).map((edu) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: ((_c = outputData.skills) === null || _c === void 0 ? void 0 : _c.map((skill) => ({ name: skill.name }))) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })) || [],
        };
        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(pdfData, finalTemplate, (normalizedLanguage || language));
        sendPdfDocument(res, doc, 'resume.pdf');
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'generate PDF');
    }
}));
// POST /api/resumes - Save resume and return data (for debugging)
router.post('/', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c, _d, _e;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        const { template = 'modern', ...resumeData } = req.body;
        console.log('Received work experience count:', ((_b = resumeData.workExperience) === null || _b === void 0 ? void 0 : _b.length) || 0);
        const validatedData = ResumeSchema.parse(resumeData);
        console.log('Validated work experience count:', ((_c = validatedData.workExperience) === null || _c === void 0 ? void 0 : _c.length) || 0);
        const resume = await (0, resumeService_1.createResume)({
            ...validatedData,
            education: (validatedData.education || []).map((edu) => {
                var _a;
                return ({
                    ...edu,
                    startYear: (_a = edu === null || edu === void 0 ? void 0 : edu.startYear) !== null && _a !== void 0 ? _a : undefined,
                });
            }),
            userId
        });
        // Fetch the complete resume with all relations to verify data was saved
        const completeResume = await (0, resumeService_1.getResumeById)(resume.id, userId);
        console.log('Saved work experiences:', ((_d = completeResume === null || completeResume === void 0 ? void 0 : completeResume.workExperiences) === null || _d === void 0 ? void 0 : _d.length) || 0);
        // Return the saved resume data instead of PDF for debugging
        res.json({
            success: true,
            resumeId: resume.id,
            workExperiencesCount: ((_e = completeResume === null || completeResume === void 0 ? void 0 : completeResume.workExperiences) === null || _e === void 0 ? void 0 : _e.length) || 0,
            resume: completeResume
        });
    }
    catch (error) {
        console.error('Error saving resume:', error);
        if (error instanceof zod_1.z.ZodError) {
            console.error('Validation errors:', error.errors);
            (0, errorHandling_1.handleValidationError)(error, res);
        }
        else {
            (0, errorHandling_1.handleDatabaseError)(error, res, 'create resume');
        }
    }
}));
// GET /api/resumes
router.get('/', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        const resumes = await (0, resumeService_1.getUserResumes)(userId);
        res.json(resumes);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch resumes');
    }
}));
// GET /api/resumes/:id
router.get('/:id', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        const resumeId = parseInt(req.params.id, 10);
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }
        const resume = await (0, resumeService_1.getResumeById)(resumeId, userId);
        if (!resume) {
            (0, errorHandling_1.handleNotFound)(res, 'Resume');
            return;
        }
        res.json(resume);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch resume');
    }
}));
// PUT /api/resumes/:id - Update a specific resume
router.put('/:id', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        const resumeId = parseInt(req.params.id, 10);
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
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
        const existingResume = await (0, resumeService_1.getResumeById)(resumeId, userId);
        if (!existingResume) {
            (0, errorHandling_1.handleNotFound)(res, 'Resume');
            return;
        }
        // Handle translation when user wants to change the resume language
        // This will translate content from its detected source language to the target language specified in the request
        if (validatedData.language) {
            const targetLanguage = (0, language_1.normalizeLanguageCode)(validatedData.language);
            // Detect source language from the content being updated
            let sourceLanguage = 'en'; // default to English
            if (validatedData.summary) {
                try {
                    const detected = await (0, language_1.detectLanguage)(validatedData.summary);
                    sourceLanguage = detected.code;
                }
                catch (error) {
                    console.warn('Language detection failed, defaulting to English:', error);
                }
            }
            else if (validatedData.workExperience && validatedData.workExperience.length > 0) {
                try {
                    const firstExp = validatedData.workExperience[0];
                    const textToDetect = [firstExp.jobTitle, firstExp.description].filter(Boolean).join(' ');
                    if (textToDetect) {
                        const detected = await (0, language_1.detectLanguage)(textToDetect);
                        sourceLanguage = detected.code;
                    }
                }
                catch (error) {
                    console.warn('Language detection failed, defaulting to English:', error);
                }
            }
            // Only translate if source and target languages are different
            if (sourceLanguage !== targetLanguage) {
                console.log(`Translating resume content from ${sourceLanguage} to ${targetLanguage}`);
                console.log(`Source language detected from: ${validatedData.summary ? 'summary' : 'work experience'}`);
                // Fields that get translated:
                // - Summary, job titles, descriptions, degrees, certifications, institution names
                // - Skills (technical terms that might benefit from translation)
                // - Language proficiency levels (e.g., "Fluent" -> "Courant")
                // Fields that are preserved (typically proper nouns):
                // - Company names, issuer names
                // - Language names (e.g., "English", "French")
                if (validatedData.summary) {
                    validatedData.summary = await (0, openai_2.translateText)(validatedData.summary, targetLanguage);
                }
                if (validatedData.workExperience && validatedData.workExperience.length > 0) {
                    validatedData.workExperience = await Promise.all(validatedData.workExperience.map(async (exp) => ({
                        ...exp,
                        jobTitle: exp.jobTitle ? await (0, openai_2.translateText)(exp.jobTitle, targetLanguage, { preserveTerms: JOB_TITLE_PRESERVE_TERMS }) : exp.jobTitle,
                        company: exp.company, // company names typically unchanged
                        location: exp.location ? await (0, openai_2.translateText)(exp.location, targetLanguage) : exp.location,
                        description: exp.description ? await (0, openai_2.translateText)(exp.description, targetLanguage) : exp.description,
                    })));
                }
                if (validatedData.education && validatedData.education.length > 0) {
                    validatedData.education = await Promise.all(validatedData.education.map(async (edu) => ({
                        ...edu,
                        degree: edu.degree ? await (0, openai_2.translateText)(edu.degree, targetLanguage) : edu.degree,
                        major: edu.major ? await (0, openai_2.translateText)(edu.major, targetLanguage) : edu.major,
                        institution: edu.institution ? await (0, openai_2.translateText)(edu.institution, targetLanguage) : edu.institution,
                        description: edu.description ? await (0, openai_2.translateText)(edu.description, targetLanguage) : edu.description,
                    })));
                }
                if (validatedData.certifications && validatedData.certifications.length > 0) {
                    validatedData.certifications = await Promise.all(validatedData.certifications.map(async (cert) => ({
                        ...cert,
                        name: cert.name ? await (0, openai_2.translateText)(cert.name, targetLanguage) : cert.name,
                        issuer: cert.issuer, // proper noun
                    })));
                }
                // Translate skills (technical terms, but some might benefit from translation)
                if (validatedData.skills && validatedData.skills.length > 0) {
                    validatedData.skills = await Promise.all(validatedData.skills.map(async (skill) => ({
                        ...skill,
                        name: skill.name ? await (0, openai_2.translateText)(skill.name, targetLanguage) : skill.name,
                    })));
                }
                // Translate language proficiency levels
                if (validatedData.languages && validatedData.languages.length > 0) {
                    validatedData.languages = await Promise.all(validatedData.languages.map(async (lang) => ({
                        ...lang,
                        name: lang.name, // language names are typically kept as-is (e.g., "English", "French")
                        proficiency: lang.proficiency ? await (0, openai_2.translateText)(lang.proficiency, targetLanguage) : lang.proficiency,
                    })));
                }
                console.log(`Translation completed for ${targetLanguage}`);
            }
            else {
                console.log(`No translation needed: content is already in ${targetLanguage}`);
            }
        }
        // Process skills and languages (after translation, so translated names are persisted)
        const processedSkills = skillsProvided ? await (0, resumeService_1.processSkills)(validatedData.skills) : [];
        const processedLanguages = languagesProvided ? await (0, resumeService_1.processLanguages)(validatedData.languages) : [];
        // Update the resume with cascade updates
        const updateData = {};
        // Only update fields that are provided
        if (validatedData.fullName !== undefined)
            updateData.fullName = validatedData.fullName;
        if (validatedData.email !== undefined)
            updateData.email = validatedData.email;
        if (validatedData.phone !== undefined)
            updateData.phone = validatedData.phone;
        if (validatedData.address !== undefined)
            updateData.address = validatedData.address;
        if (validatedData.linkedIn !== undefined)
            updateData.linkedIn = validatedData.linkedIn;
        if (validatedData.website !== undefined)
            updateData.website = validatedData.website;
        if (validatedData.summary !== undefined)
            updateData.summary = validatedData.summary;
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
                        create: validatedData.education.map(edu => {
                            var _a;
                            return ({
                                degree: edu.degree,
                                institution: edu.institution,
                                startYear: (_a = edu.startYear) !== null && _a !== void 0 ? _a : undefined,
                                graduationYear: edu.graduationYear,
                                description: edu.description,
                            });
                        }),
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
        const updatedResume = await database_1.prisma.resume.update({
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
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            (0, errorHandling_1.handleValidationError)(error, res);
        }
        else {
            (0, errorHandling_1.handleDatabaseError)(error, res, 'update resume');
        }
    }
}));
// DELETE /api/resumes/:id - Delete a specific resume
router.delete('/:id', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        const resumeId = parseInt(req.params.id, 10);
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }
        // Check if resume exists and belongs to user
        const existingResume = await (0, resumeService_1.getResumeById)(resumeId, userId);
        if (!existingResume) {
            (0, errorHandling_1.handleNotFound)(res, 'Resume');
            return;
        }
        // Delete the resume (cascading deletes will handle related records)
        await database_1.prisma.resume.delete({
            where: { id: resumeId },
        });
        res.status(204).send();
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'delete resume');
    }
}));
// Dashboard stats endpoint
router.get('/dashboard/stats', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    try {
        // Get resume count
        const resumeCount = await database_1.prisma.resume.count({
            where: { userId }
        });
        // Get cover letter count
        const coverLetterCount = await database_1.prisma.coverLetter.count({
            where: { userId }
        });
        // Get job tracking stats
        const jobs = await database_1.prisma.job.findMany({
            where: { userId },
            select: { status: true }
        });
        const totalJobs = jobs.length;
        const appliedJobs = jobs.filter((job) => job.status === 'applied').length;
        const interviewingJobs = jobs.filter((job) => job.status === 'interviewing').length;
        const rejectedJobs = jobs.filter((job) => job.status === 'rejected').length;
        const offerJobs = jobs.filter((job) => job.status === 'offer').length;
        const withdrawnJobs = jobs.filter((job) => job.status === 'withdrawn').length;
        const pendingJobs = jobs.filter((job) => job.status === 'pending').length;
        const followUpJobs = jobs.filter((job) => job.status === 'follow-up').length;
        // Calculate response rate
        const responseCounts = interviewingJobs + offerJobs + pendingJobs + followUpJobs;
        const responseRate = totalJobs > 0 ? Math.round((responseCounts / totalJobs) * 100) : 0;
        const interviewRate = totalJobs > 0 ? Math.round((interviewingJobs / totalJobs) * 100) : 0;
        const offerRate = totalJobs > 0 ? Math.round((offerJobs / totalJobs) * 100) : 0;
        // Get user subscription status
        const user = await database_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                planType: true,
                subscriptionStatus: true,
                subscriptionEnd: true
            }
        });
        const isPremium = Boolean((user === null || user === void 0 ? void 0 : user.planType) === 'premium' &&
            user.subscriptionStatus === 'active' &&
            user.subscriptionEnd &&
            new Date(user.subscriptionEnd) > new Date());
        const dashboardStats = {
            user: {
                isPremium,
                planType: (user === null || user === void 0 ? void 0 : user.planType) || 'free',
                subscriptionStatus: (user === null || user === void 0 ? void 0 : user.subscriptionStatus) || 'none'
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
    }
    catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
}));
// POST /api/resumes/:id/pdf
router.post('/:id/pdf', auth_1.ensureAuthenticated, subscription_1.withPremiumFeatures, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c, _d, _e;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'modern', language: reqLanguage } = req.body;
        const languageProvided = typeof reqLanguage === 'string' && reqLanguage.trim().length > 0;
        const normalizedLanguage = (0, language_1.normalizeLanguageCode)(languageProvided ? reqLanguage : undefined);
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }
        const resume = await (0, resumeService_1.getResumeById)(resumeId, userId);
        if (!resume) {
            (0, errorHandling_1.handleNotFound)(res, 'Resume');
            return;
        }
        // Check if user is premium, if not restrict to basic template
        const isPremium = ((_b = req.user) === null || _b === void 0 ? void 0 : _b.isPremium) || false;
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
            workExperience: (outputData.workExperience || []).map((exp) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            })) || [],
            education: (outputData.education || []).map((edu) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: ((_c = outputData.skills) === null || _c === void 0 ? void 0 : _c.map((skill) => ({ name: skill.name }))) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert) => ({
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
                const basis = resume.summary || ((_e = (_d = resume.workExperiences) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.description) || '';
                if (basis && basis.length > 0) {
                    const detected = await (0, language_1.detectLanguage)(basis);
                    if (detected === null || detected === void 0 ? void 0 : detected.code)
                        effectiveLanguage = detected.code;
                }
            }
        }
        catch (_f) { }
        const generateResume = require('../templates');
        const doc = generateResume(pdfData, finalTemplate, effectiveLanguage);
        sendPdfDocument(res, doc, 'resume.pdf');
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'generate PDF');
    }
}));
// POST /api/resumes/:id/enhance-pdf - Keep premium only
router.post('/:id/enhance-pdf', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _m, _o, _p, _q, _r, _s, _u;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { jobDescription, template = 'modern', language = 'en' } = req.body;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }
        if (!jobDescription || typeof jobDescription !== 'string') {
            return res.status(400).json({ error: 'Job description is required' });
        }
        const resume = await (0, resumeService_1.getResumeById)(resumeId, userId);
        if (!resume) {
            (0, errorHandling_1.handleNotFound)(res, 'Resume');
            return;
        }
        // Get language configuration
        const languageConfig = (0, language_1.getLanguageConfig)(language);
        const languageInfo = (0, language_1.getLanguageInfo)(language);
        // Prepare resume data for enhancement
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
            workExperience: ((_b = resume.workExperiences) === null || _b === void 0 ? void 0 : _b.map((exp) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            }))) || [],
            education: ((_c = resume.educations) === null || _c === void 0 ? void 0 : _c.map((edu) => ({
                degree: edu.degree,
                major: edu.major,
                institution: edu.institution,
                graduationYear: edu.graduationYear,
                gpa: edu.gpa,
                description: edu.description,
            }))) || [],
            certifications: ((_d = resume.certifications) === null || _d === void 0 ? void 0 : _d.map((cert) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate,
            }))) || [],
        };
        // Extract and match skills from job description
        console.log('Extracting skills from job description...');
        const matchedSkills = await extractAndMatchSkills(jobDescription, resume.skills || [], language);
        console.log(`Found ${matchedSkills.length} matched skills from job description`);
        // Create enhanced skills list combining matched skills with existing resume skills
        const enhancedSkills = [...(resume.skills || []), ...matchedSkills];
        // Remove duplicates based on skill name
        const uniqueSkills = enhancedSkills.filter((skill, index, self) => index === self.findIndex(s => s.name.toLowerCase() === skill.name.toLowerCase()));
        console.log(`Total unique skills for enhancement: ${uniqueSkills.length}`);
        console.log('Skills to include:', uniqueSkills.map(skill => skill.name));
        const prompt = `You are a resume optimizer. Tailor the resume below to match the job description.

RULES:
- Return ONLY valid JSON, no markdown, no explanation
- Be concise: keep descriptions to 1-2 sentences max
- Use bullet points (•) for work experience descriptions
- Include relevant keywords from the job description
- Do not invent experiences, only reframe existing ones

${languageInfo.instruction}

Skills to include: ${uniqueSkills.map(s => s.name).join(', ')}

Job Description: ${jobDescription}

Original Resume: ${JSON.stringify(resumeData)}

Return JSON with this structure:
{"fullName":"","email":"","phone":"","address":"","linkedIn":"","website":"","summary":"","skills":[{"name":""}],"languages":[{"name":"","proficiency":""}],"workExperience":[{"jobTitle":"","company":"","location":"","startDate":"","endDate":"","description":"","companyDescription":"","techStack":""}],"education":[{"degree":"","major":"","institution":"","graduationYear":0,"gpa":0,"description":""}],"certifications":[{"name":"","issuer":"","issueDate":""}]}`;
        console.log('Prompt:', prompt);
        // Call OpenAI to enhance the resume
        let enhancedResume = null;
        const maxRetries = 2;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Enhancement attempt ${attempt}/${maxRetries}...`);
                const response = await openai_1.openai.chat.completions.create({
                    model: process.env.OPENAI_MODEL || 'gpt-5.2',
                    messages: [
                        { role: 'system', content: languageConfig.systemMessage },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.5,
                    max_tokens: 8192,
                });
                console.log('AI response structure:', {
                    hasChoices: !!response.choices,
                    choicesLength: (_e = response.choices) === null || _e === void 0 ? void 0 : _e.length,
                    firstChoiceHasMessage: !!((_g = (_f = response.choices) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.message),
                    contentType: typeof ((_k = (_j = (_h = response.choices) === null || _h === void 0 ? void 0 : _h[0]) === null || _j === void 0 ? void 0 : _j.message) === null || _k === void 0 ? void 0 : _k.content),
                    contentLength: (_q = (_p = (_o = (_m = response.choices) === null || _m === void 0 ? void 0 : _m[0]) === null || _o === void 0 ? void 0 : _o.message) === null || _p === void 0 ? void 0 : _p.content) === null || _q === void 0 ? void 0 : _q.length,
                });
                const content = (_u = (_s = (_r = response.choices[0]) === null || _r === void 0 ? void 0 : _r.message) === null || _s === void 0 ? void 0 : _s.content) === null || _u === void 0 ? void 0 : _u.trim();
                if (!content) {
                    console.warn(`Attempt ${attempt}: AI returned empty content`);
                    console.log('Full response:', JSON.stringify(response, null, 2).substring(0, 1000));
                    continue;
                }
                console.log(`Attempt ${attempt}: AI returned ${content.length} chars, first 200:`, content.substring(0, 200));
                console.log(`Attempt ${attempt}: Last 200 chars:`, content.substring(Math.max(0, content.length - 200)));
                enhancedResume = tryParseJsonObject(content);
                if (enhancedResume) {
                    console.log(`Attempt ${attempt}: Successfully parsed JSON with keys:`, Object.keys(enhancedResume));
                    break;
                }
                console.warn(`Attempt ${attempt}: JSON parse failed`);
            }
            catch (apiError) {
                console.error(`API error on attempt ${attempt}:`, {
                    message: apiError.message,
                    status: apiError.status,
                    code: apiError.code,
                    type: apiError.type,
                });
                if (attempt === maxRetries) {
                    throw apiError;
                }
            }
        }
        if (!enhancedResume) {
            return res.status(500).json({ error: 'Failed to enhance resume' });
        }
        // Save the enhanced resume to the database
        const processedSkills = await (0, resumeService_1.processSkills)(enhancedResume.skills || []);
        const processedLanguages = await (0, resumeService_1.processLanguages)(enhancedResume.languages || []);
        // Be tolerant to slight key name variations from the model
        const finalWorkExperience = enhancedResume.workExperience || enhancedResume.workExperiences || [];
        const finalEducation = enhancedResume.education || enhancedResume.educations || [];
        const finalCertifications = enhancedResume.certifications || [];
        const savedResume = await database_1.prisma.resume.create({
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
                    create: (finalWorkExperience || []).map((exp) => ({
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
                    create: (finalEducation || []).map((edu) => ({
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
                    create: (finalCertifications || []).map((cert) => ({
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
    }
    catch (error) {
        console.error('Error in enhance-pdf endpoint:', error);
        res.status(500).json({ error: 'Failed to enhance resume' });
    }
}));
// POST /api/resumes/:id/html - Get resume as HTML
router.post('/:id/html', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c, _d;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { template = 'colorful', language = 'en' } = req.query;
        const languageProvided = typeof req.query.language === 'string' && req.query.language.trim().length > 0;
        const normalizedLanguage = (0, language_1.normalizeLanguageCode)(languageProvided ? req.query.language : undefined);
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }
        const resume = await (0, resumeService_1.getResumeById)(resumeId, userId);
        if (!resume) {
            (0, errorHandling_1.handleNotFound)(res, 'Resume');
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
            workExperience: (outputData.workExperience || []).map((exp) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription || undefined,
                techStack: exp.techStack,
            })) || [],
            education: (outputData.education || []).map((edu) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: ((_b = outputData.skills) === null || _b === void 0 ? void 0 : _b.map((skill) => ({ name: skill.name }))) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert) => ({
                name: cert.name,
                issuer: cert.issuer,
                issueDate: cert.issueDate || null,
            })) || [],
        };
        // Determine effective language for preview: prefer query param, else detect
        let effectiveLanguage = languageProvided ? normalizedLanguage : 'en';
        if (!languageProvided) {
            try {
                const basis = (resume.summary || '') || (((_d = (_c = resume.workExperiences) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.description) || '');
                if (basis) {
                    const detected = await (0, language_1.detectLanguage)(basis);
                    if (detected === null || detected === void 0 ? void 0 : detected.code)
                        effectiveLanguage = detected.code;
                }
            }
            catch (_e) { }
        }
        const html = (0, htmlResumeService_1.generateHTMLResume)(resumeData, template, effectiveLanguage);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    }
    catch (error) {
        console.error('Error in HTML resume endpoint:', error);
        res.status(500).json({ error: 'Failed to generate HTML resume' });
    }
}));
// POST /api/resumes/save-and-html-pdf - Save new resume and return PDF from HTML template
router.post('/save-and-html-pdf', auth_1.ensureAuthenticated, subscription_1.withPremiumFeatures, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        // NOTE: Frontend preview uses query params (`/html?template=minimal`).
        // Some clients also pass template/language in query for this POST endpoint.
        // Support both body + query to avoid silently falling back to defaults.
        const template = (typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.template) === 'string' && req.body.template.trim().length > 0)
            ? req.body.template
            : ((typeof ((_c = req.query) === null || _c === void 0 ? void 0 : _c.template) === 'string' && req.query.template.trim().length > 0)
                ? req.query.template
                : 'colorful');
        const language = (typeof ((_d = req.body) === null || _d === void 0 ? void 0 : _d.language) === 'string' && req.body.language.trim().length > 0)
            ? req.body.language
            : ((typeof ((_e = req.query) === null || _e === void 0 ? void 0 : _e.language) === 'string' && req.query.language.trim().length > 0)
                ? req.query.language
                : 'en');
        const { template: _t, language: _l, ...resumeData } = req.body;
        const languageProvided = (typeof ((_f = req.body) === null || _f === void 0 ? void 0 : _f.language) === 'string' && req.body.language.trim().length > 0)
            || (typeof ((_g = req.query) === null || _g === void 0 ? void 0 : _g.language) === 'string' && req.query.language.trim().length > 0);
        const normalizedLanguage = (0, language_1.normalizeLanguageCode)(typeof language === 'string' ? language : undefined);
        const validatedData = ResumeSchema.parse({ ...resumeData, language: normalizedLanguage });
        const outputData = languageProvided
            ? await translateResumeContent(validatedData, normalizedLanguage)
            : validatedData;
        // Save the resume to database (with translated content, so persisted data matches display)
        const resume = await (0, resumeService_1.createResume)({
            ...outputData,
            education: (outputData.education || []).map((edu) => {
                var _a;
                return ({
                    ...edu,
                    startYear: (_a = edu === null || edu === void 0 ? void 0 : edu.startYear) !== null && _a !== void 0 ? _a : undefined,
                });
            }),
            userId
        });
        // Convert resume data to HTML format
        const htmlResumeData = {
            fullName: outputData.fullName,
            email: outputData.email,
            phone: outputData.phone || undefined,
            address: outputData.address || undefined,
            linkedIn: outputData.linkedIn || undefined,
            website: outputData.website || undefined,
            summary: outputData.summary || '',
            workExperience: (outputData.workExperience || []).map((exp) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription || undefined,
                techStack: exp.techStack,
            })),
            education: (outputData.education || []).map((edu) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })),
            skills: ((_h = outputData.skills) === null || _h === void 0 ? void 0 : _h.map((skill) => ({ name: skill.name }))) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert) => ({
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
                const basis = (validatedData.summary || '') || (((_k = (_j = validatedData.workExperience) === null || _j === void 0 ? void 0 : _j[0]) === null || _k === void 0 ? void 0 : _k.description) || '');
                if (basis) {
                    const detected = await (0, language_1.detectLanguage)(basis);
                    if (detected === null || detected === void 0 ? void 0 : detected.code)
                        effectiveLanguage = detected.code;
                }
            }
            catch (_m) { }
        }
        console.log('save-and-html-pdf using template:', template, 'language:', effectiveLanguage);
        const html = (0, htmlResumeService_1.generateHTMLResume)(htmlResumeData, template, effectiveLanguage);
        // Convert HTML to PDF using Puppeteer
        const puppeteer = require('puppeteer');
        const executablePath = await resolveChromeExecutablePath(puppeteer);
        const launchOptions = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--font-render-hinting=none'
            ]
        };
        if (executablePath)
            launchOptions.executablePath = executablePath;
        console.log('Launching Puppeteer with options:', JSON.stringify({ ...launchOptions, executablePath: 'REDACTED' }));
        const browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        // Set content and wait for rendering
        await page.setContent(html, { waitUntil: 'networkidle0' });
        // Ensure print CSS is applied when rendering to PDF.
        // (Chromium usually does this automatically for page.pdf(), but making it explicit avoids
        // environment-dependent differences between preview and generated PDF.)
        await page.emulateMediaType('print');
        // If the rendered content spans multiple pages, add a small top padding to pages 2+.
        // Requirement: add 12px top padding when resume is longer than one page.
        // IMPORTANT: preserve existing left/right/bottom spacing.
        const chosenScale = template === 'minimal' ? 0.97 : 1;
        const a4PageHeightPx = 1123; // 297mm @ 96dpi ≈ 1122.52px
        // Use globalThis to avoid requiring DOM typings in the Node/TS compilation context.
        const documentHeightPx = await page.evaluate(() => globalThis.document.documentElement.scrollHeight);
        const estimatedPages = Math.ceil((documentHeightPx * chosenScale) / a4PageHeightPx);
        const noMarginTemplates = ['minimal', 'modern', 'colorful'];
        const useMinimalMargins = noMarginTemplates.includes(template);
        const baseMargin = useMinimalMargins ? '0mm' : '20mm';
        if (estimatedPages > 1) {
            // Apply 12px only to pages after the first.
            // Use calc() so we keep the original top margin and add the padding.
            const plusTop = baseMargin === '0mm' ? '12px' : `calc(${baseMargin} + 12px)`;
            await page.addStyleTag({
                content: `@page { size: A4; margin: ${plusTop} ${baseMargin} ${baseMargin} ${baseMargin}; }\n@page :first { size: A4; margin: ${baseMargin} ${baseMargin} ${baseMargin} ${baseMargin}; }`
            });
        }
        else {
            // Keep size consistent without overriding margins.
            await page.addStyleTag({ content: '@page { size: A4; }' });
        }
        // Generate PDF
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            // Slightly scale down templates that are designed for on-screen preview so they don't
            // spill onto a 2nd page due to font/rendering differences.
            scale: chosenScale,
            margin: useMinimalMargins ? {
                top: '0mm',
                right: '0mm',
                bottom: '0mm',
                left: '0mm'
            } : {
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
    }
    catch (error) {
        console.error('PDF Generation Error:', error);
        if (error instanceof zod_1.z.ZodError) {
            (0, errorHandling_1.handleValidationError)(error, res);
        }
        else {
            (0, errorHandling_1.handleDatabaseError)(error, res, 'generate HTML PDF');
        }
    }
}));
// POST /api/resumes/:id/html-pdf - Convert existing resume to PDF using HTML template
router.post('/:id/html-pdf', auth_1.ensureAuthenticated, subscription_1.withPremiumFeatures, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        const resumeId = parseInt(req.params.id, 10);
        // NOTE: HTML preview endpoint takes query params (`/html?template=minimal`).
        // Some clients mistakenly send `/html-pdf?template=minimal` without including it in the POST body.
        // Support both to ensure the selected template is actually used.
        const template = (typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.template) === 'string' && req.body.template.trim().length > 0)
            ? req.body.template
            : ((typeof ((_c = req.query) === null || _c === void 0 ? void 0 : _c.template) === 'string' && req.query.template.trim().length > 0)
                ? req.query.template
                : 'colorful');
        const language = (typeof ((_d = req.body) === null || _d === void 0 ? void 0 : _d.language) === 'string' && req.body.language.trim().length > 0)
            ? req.body.language
            : ((typeof ((_e = req.query) === null || _e === void 0 ? void 0 : _e.language) === 'string' && req.query.language.trim().length > 0)
                ? req.query.language
                : 'en');
        const languageProvided = (typeof ((_f = req.body) === null || _f === void 0 ? void 0 : _f.language) === 'string' && req.body.language.trim().length > 0)
            || (typeof ((_g = req.query) === null || _g === void 0 ? void 0 : _g.language) === 'string' && req.query.language.trim().length > 0);
        const normalizedLanguage = (0, language_1.normalizeLanguageCode)(typeof language === 'string' ? language : undefined);
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        if (isNaN(resumeId)) {
            return res.status(400).json({ error: 'Invalid resume ID' });
        }
        const resume = await (0, resumeService_1.getResumeById)(resumeId, userId);
        if (!resume) {
            (0, errorHandling_1.handleNotFound)(res, 'Resume');
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
            workExperience: (outputData.workExperience || []).map((exp) => ({
                jobTitle: exp.jobTitle,
                company: exp.company,
                location: exp.location,
                startDate: exp.startDate,
                endDate: exp.endDate,
                description: exp.description,
                companyDescription: exp.companyDescription,
                techStack: exp.techStack,
            })),
            education: (outputData.education || []).map((edu) => ({
                degree: edu.degree,
                institution: edu.institution,
                startYear: edu.startYear,
                graduationYear: edu.graduationYear,
                description: edu.description,
            })) || [],
            skills: ((_h = outputData.skills) === null || _h === void 0 ? void 0 : _h.map((skill) => ({ name: skill.name }))) || [],
            languages: outputData.languages || [],
            certifications: (outputData.certifications || []).map((cert) => ({
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
                const basis = (resume.summary || '') || (((_k = (_j = resume.workExperiences) === null || _j === void 0 ? void 0 : _j[0]) === null || _k === void 0 ? void 0 : _k.description) || '');
                if (basis) {
                    const detected = await (0, language_1.detectLanguage)(basis);
                    if (detected === null || detected === void 0 ? void 0 : detected.code)
                        effectiveLanguage = detected.code;
                }
            }
            catch (_m) { }
        }
        console.log('html-pdf using template:', template, 'language:', effectiveLanguage);
        const html = (0, htmlResumeService_1.generateHTMLResume)(resumeData, template, effectiveLanguage);
        // Convert HTML to PDF using Puppeteer
        const puppeteer = require('puppeteer');
        const executablePath = await resolveChromeExecutablePath(puppeteer);
        const launchOptions2 = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--font-render-hinting=none'
            ]
        };
        if (executablePath)
            launchOptions2.executablePath = executablePath;
        console.log('Launching Puppeteer (HTML-PDF) with options:', JSON.stringify({ ...launchOptions2, executablePath: 'REDACTED' }));
        const browser = await puppeteer.launch(launchOptions2);
        const page = await browser.newPage();
        // Set content and wait for rendering
        await page.setContent(html, { waitUntil: 'networkidle0' });
        // Ensure print CSS is applied when rendering to PDF.
        await page.emulateMediaType('print');
        // If the rendered content spans multiple pages, add a small top padding to pages 2+.
        // Requirement: add 12px top padding when resume is longer than one page.
        // IMPORTANT: preserve existing left/right/bottom spacing.
        const chosenScale = template === 'minimal' ? 0.97 : 1;
        const a4PageHeightPx = 1123; // 297mm @ 96dpi ≈ 1122.52px
        // Use globalThis to avoid requiring DOM typings in the Node/TS compilation context.
        const documentHeightPx = await page.evaluate(() => globalThis.document.documentElement.scrollHeight);
        const estimatedPages = Math.ceil((documentHeightPx * chosenScale) / a4PageHeightPx);
        const noMarginTemplates = ['minimal', 'modern', 'colorful'];
        const useMinimalMargins = noMarginTemplates.includes(template);
        const baseMargin = useMinimalMargins ? '0mm' : '20mm';
        if (estimatedPages > 1) {
            const plusTop = baseMargin === '0mm' ? '12px' : `calc(${baseMargin} + 12px)`;
            await page.addStyleTag({
                content: `@page { size: A4; margin: ${plusTop} ${baseMargin} ${baseMargin} ${baseMargin}; }\n@page :first { size: A4; margin: ${baseMargin} ${baseMargin} ${baseMargin} ${baseMargin}; }`
            });
        }
        else {
            await page.addStyleTag({ content: '@page { size: A4; }' });
        }
        // Generate PDF
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            scale: chosenScale,
            margin: useMinimalMargins ? {
                top: '0mm',
                right: '0mm',
                bottom: '0mm',
                left: '0mm'
            } : {
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
    }
    catch (error) {
        console.error('Error in HTML PDF endpoint:', error);
        // Include error message in response for better debugging in prod
        res.status(500).json({
            error: 'Failed to generate HTML PDF',
            details: error instanceof Error ? error.message : String(error)
        });
    }
}));
// POST /api/resumes/upload
router.post('/upload', auth_1.ensureAuthenticated, upload.single('file'), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c, _d;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        // Step 1: Extract text from file locally
        let extractedText;
        const { buffer, mimetype, originalname } = req.file;
        if (mimetype === 'application/pdf') {
            const pdfjsLib = require('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = '';
            const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
            const pdf = await loadingTask.promise;
            const textParts = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                textParts.push(textContent.items.map((item) => item.str).join(' '));
            }
            extractedText = textParts.join('\n');
        }
        else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mimetype === 'application/msword') {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            extractedText = result.value;
        }
        else {
            return res.status(400).json({ error: 'Only PDF and Word documents are allowed' });
        }
        if (!extractedText || extractedText.trim().length < 50) {
            return res.status(400).json({ error: 'Could not extract enough text from the file. Please ensure the file contains readable text.' });
        }
        // Step 2: Send extracted text to LLM for structured extraction
        const resumeSchemaJson = JSON.stringify({
            type: 'object',
            required: ['fullName', 'email', 'workExperience', 'education'],
            properties: {
                fullName: { type: 'string', description: 'Full name of the person' },
                email: { type: 'string', format: 'email' },
                phone: { type: 'string' },
                address: { type: 'string' },
                linkedIn: { type: 'string' },
                website: { type: 'string' },
                summary: { type: 'string', description: 'Professional summary' },
                skills: {
                    type: 'array',
                    items: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
                },
                workExperience: {
                    type: 'array',
                    minItems: 1,
                    items: {
                        type: 'object',
                        required: ['jobTitle', 'company', 'startDate'],
                        properties: {
                            jobTitle: { type: 'string' },
                            company: { type: 'string' },
                            location: { type: 'string' },
                            startDate: { type: 'string', description: 'Start date in YYYY-MM-DD or MM/YYYY format' },
                            endDate: { type: 'string', description: 'End date in YYYY-MM-DD or MM/YYYY format, or null if current' },
                            isCurrent: { type: 'boolean' },
                            description: { type: 'string' },
                            companyDescription: { type: 'string' },
                            techStack: { type: 'string' }
                        }
                    }
                },
                education: {
                    type: 'array',
                    minItems: 1,
                    items: {
                        type: 'object',
                        required: ['degree', 'institution'],
                        properties: {
                            degree: { type: 'string' },
                            major: { type: 'string' },
                            institution: { type: 'string' },
                            startYear: { type: 'integer' },
                            graduationYear: { type: 'integer' },
                            gpa: { type: 'number' },
                            description: { type: 'string' }
                        }
                    }
                },
                languages: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['name', 'proficiency'],
                        properties: { name: { type: 'string' }, proficiency: { type: 'string' } }
                    }
                },
                certifications: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['name', 'issuer'],
                        properties: { name: { type: 'string' }, issuer: { type: 'string' }, issueDate: { type: 'string' } }
                    }
                },
                language: { type: 'string', default: 'en', description: 'ISO 639-1 language code of the resume' }
            }
        });
        const systemPrompt = `You are a resume parser. Extract all information from the resume text and return it as a JSON object matching this schema:

${resumeSchemaJson}

Rules:
- Return ONLY valid JSON, no markdown, no explanation
- If a field is not found, omit it (except required fields which must have a value)
- For dates, use YYYY-MM-DD format when possible, or MM/YYYY
- For skills, extract individual skills (not categories)
- For languages, use standard names (e.g., "English", "French", "Spanish")
- For proficiency, use: "Native", "Fluent", "Advanced", "Intermediate", "Beginner"
- If the resume is not in English, set the "language" field to the appropriate ISO 639-1 code
- workExperience and education arrays must have at least one entry each`;
        const response = await openai_1.openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: extractedText }
            ],
            temperature: 0.1,
            max_tokens: 4000,
        });
        const content = (_c = (_b = response.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content;
        if (!content) {
            return res.status(500).json({ error: 'No response from AI model' });
        }
        let parsedData;
        try {
            const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/) || content.match(/({[\s\S]*})/);
            parsedData = jsonMatch ? JSON.parse((_d = jsonMatch[1]) !== null && _d !== void 0 ? _d : jsonMatch[0]) : JSON.parse(content);
        }
        catch (parseError) {
            console.error('JSON parse error:', parseError);
            console.log('AI response:', content);
            return res.status(500).json({ error: 'Failed to parse AI response' });
        }
        res.json(parsedData);
    }
    catch (error) {
        console.error('Error in upload endpoint:', error);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
        res.status(500).json({ error: 'Failed to process resume' });
    }
}));
// GET /api/resumes/subscription-status - Check user's subscription status and available features
router.get('/subscription-status', auth_1.ensureAuthenticated, subscription_1.withPremiumFeatures, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
        if (!userId) {
            (0, errorHandling_1.handleUnauthorized)(res);
            return;
        }
        const isPremium = ((_b = req.user) === null || _b === void 0 ? void 0 : _b.isPremium) || false;
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
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'check subscription status');
    }
}));
function tryParseJsonObject(content) {
    if (!content || typeof content !== 'string')
        return null;
    const raw = content.trim();
    // Try direct parse first
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            return parsed;
    }
    catch (_a) { }
    // Try fenced JSON with closing ```
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
    if (fenced === null || fenced === void 0 ? void 0 : fenced[1]) {
        try {
            const parsed = JSON.parse(fenced[1].trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch (_b) { }
    }
    // Try fenced JSON without closing ``` (extract everything after ```json)
    const fencedOpen = raw.match(/```json\s*([\s\S]*)/i);
    if (fencedOpen === null || fencedOpen === void 0 ? void 0 : fencedOpen[1]) {
        try {
            const parsed = JSON.parse(fencedOpen[1].trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch (_c) { }
    }
    // Try to find first { and last } and extract that
    const objMatch = raw.match(/(\{[\s\S]*\})/);
    if (objMatch === null || objMatch === void 0 ? void 0 : objMatch[1]) {
        try {
            const parsed = JSON.parse(objMatch[1]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch (_d) { }
    }
    return null;
}
function tryParseJsonStringArray(content) {
    if (!content || typeof content !== 'string')
        return null;
    const raw = content.trim();
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return parsed.filter((v) => typeof v === 'string');
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.skills)) {
            return parsed.skills.filter((v) => typeof v === 'string');
        }
    }
    catch (_a) { }
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
    if (fenced === null || fenced === void 0 ? void 0 : fenced[1]) {
        return tryParseJsonStringArray(fenced[1]);
    }
    const arrMatch = raw.match(/(\[[\s\S]*\])/);
    if (arrMatch === null || arrMatch === void 0 ? void 0 : arrMatch[1]) {
        try {
            const parsed = JSON.parse(arrMatch[1]);
            if (Array.isArray(parsed))
                return parsed.filter((v) => typeof v === 'string');
        }
        catch (_b) { }
    }
    return null;
}
// Function to extract and match skills from job description
async function extractAndMatchSkills(jobDescription, resumeSkills, language = 'en') {
    var _a, _b, _c, _d, _e, _f;
    const languageConfig = (0, language_1.getLanguageConfig)(language);
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
        const response = await openai_1.openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-5.2',
            messages: [
                { role: 'system', content: languageConfig.systemMessage },
                { role: 'user', content: extractionPrompt },
            ],
            temperature: 0.3,
            max_tokens: 1000,
        });
        const content = (_c = (_b = (_a = response.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.trim();
        if (!content) {
            return [];
        }
        const extractedSkills = tryParseJsonStringArray(content);
        if (!extractedSkills) {
            console.warn('Failed to parse extracted skills: model did not return a valid JSON array of strings');
            return [];
        }
        // Get all existing skills from database
        const allSkills = await database_1.prisma.skill.findMany({
            select: { id: true, name: true }
        });
        // Get current resume skills
        const currentResumeSkills = resumeSkills.map(skill => skill.name.toLowerCase());
        // Match extracted skills with existing skills
        const matchedSkills = [];
        const newSkills = [];
        for (const extractedSkill of extractedSkills) {
            if (!extractedSkill || typeof extractedSkill !== 'string') {
                continue;
            }
            const normalizedSkill = extractedSkill.toLowerCase().trim();
            if (normalizedSkill.length === 0) {
                continue;
            }
            // Check if skill exists in database
            const existingSkill = allSkills.find(skill => skill.name.toLowerCase() === normalizedSkill);
            if (existingSkill) {
                matchedSkills.push(existingSkill);
            }
            else {
                // Check if it's already in current resume
                if (currentResumeSkills.includes(normalizedSkill)) {
                    // Find the original skill object from resume
                    const resumeSkill = resumeSkills.find(skill => skill.name.toLowerCase() === normalizedSkill);
                    if (resumeSkill) {
                        matchedSkills.push(resumeSkill);
                    }
                }
                else {
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
        const additionalResponse = await openai_1.openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-5.2',
            messages: [
                { role: 'system', content: languageConfig.systemMessage },
                { role: 'user', content: additionalSkillsPrompt },
            ],
            temperature: 0.5,
            max_tokens: 500,
        });
        const additionalContent = (_f = (_e = (_d = additionalResponse.choices[0]) === null || _d === void 0 ? void 0 : _d.message) === null || _e === void 0 ? void 0 : _e.content) === null || _f === void 0 ? void 0 : _f.trim();
        if (additionalContent) {
            const additionalSkills = tryParseJsonStringArray(additionalContent);
            if (additionalSkills) {
                newSkills.push(...additionalSkills);
            }
            else {
                console.warn('Failed to parse additional skills: model did not return a valid JSON array of strings');
            }
        }
        // Process new skills and add them to matched skills
        if (newSkills.length > 0) {
            const processedNewSkills = await (0, resumeService_1.processSkills)(newSkills.map(name => ({ name })));
            matchedSkills.push(...processedNewSkills);
        }
        return matchedSkills;
    }
    catch (error) {
        console.error('Error extracting skills from job description:', error);
        // Fallback: return original resume skills if extraction fails
        console.log('Using fallback: returning original resume skills');
        return resumeSkills;
    }
}
exports.default = router;
