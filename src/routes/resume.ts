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
import { detectLanguage } from '../utils/language';
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
import { requirePremium, withPremiumFeatures } from '../middleware/subscription';

const router = express.Router();

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
});

const EnhanceDescriptionSchema = z.object({
    jobTitle: z.string().min(1, 'Job title is required'),
    description: z.string().min(1, 'Description is required'),
});

const EnhanceSummarySchema = z.object({
    summary: z.string().min(1, 'Summary is required'),
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
        const { summary } = parsed;

        const prompt = `Enhance the following professional summary to be more impactful, ATS-friendly, and compelling. Keep it concise (2-3 sentences) and professional. Original summary: ${summary}`;

        const enhancedSummary = await enhanceWithOpenAI(
            prompt,
            'You are a helpful assistant.',
            "A dedicated and versatile professional with a strong foundation in their field. Proven track record of delivering results and adapting to new challenges. Committed to continuous learning and professional growth."
        );

        return res.json({ enhancedSummary });
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// POST /api/resumes/enhance-description
router.post('/enhance-description', asyncHandler(async (req: any, res) => {
    try {
        const parsed = EnhanceDescriptionSchema.parse(req.body);
        const { jobTitle, description } = parsed;

        const prompt = `Enhance the following job description for a ${jobTitle} position. Make it more impactful with action verbs, quantifiable achievements, and ATS-friendly keywords. Return as bullet points with •. Original: ${description}`;

        const enhancedDescription = await enhanceWithOpenAI(
            prompt,
            'You are a helpful assistant.',
            `• Performed core responsibilities as a ${jobTitle}, enhancing team productivity and project outcomes.\n• Collaborated with stakeholders to achieve organizational goals, leveraging skills from prior experience.\n• Contributed to key initiatives, adapting to dynamic work environments.`
        );

        return res.json({ enhancedDescription });
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

        const { template = 'modern', ...resumeData } = req.body;
        const validatedData = ResumeSchema.parse(resumeData);

        // Check if user is premium, if not restrict to basic template
        const isPremium = req.user?.isPremium || false;
        const finalTemplate = isPremium ? template : 'modern'; // Free users get modern template only

        // Generate PDF using template without saving to database
        const generateResume = require('../templates');
        const doc = generateResume(validatedData, finalTemplate);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');

        doc.pipe(res);
        doc.end();
    } catch (error) {
        if (error instanceof z.ZodError) {
            handleValidationError(error, res);
        } else {
            handleDatabaseError(error, res, 'generate PDF');
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

        const { template = 'modern', ...resumeData } = req.body;
        const validatedData = ResumeSchema.parse(resumeData);

        const resume = await createResume({
            ...validatedData,
            userId
        } as ResumeData);

        // Check if user is premium, if not restrict to basic template
        const isPremium = req.user?.isPremium || false;
        const finalTemplate = isPremium ? template : 'modern'; // Free users get modern template only

        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(validatedData, finalTemplate);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');

        doc.pipe(res);
        doc.end();
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
        const { template = 'modern' } = req.query;

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
        const finalTemplate = isPremium ? (template as string) : 'modern'; // Free users get modern template only

        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(resume, finalTemplate);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');

        doc.pipe(res);
        doc.end();
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
        const { template = 'modern' } = req.body;

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

        // Generate PDF using template
        const generateResume = require('../templates');
        const doc = generateResume(resume, finalTemplate);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');

        doc.pipe(res);
        doc.end();
    } catch (error) {
        handleDatabaseError(error, res, 'generate PDF');
    }
}));

// POST /api/resumes/:id/enhance-pdf - Keep premium only
router.post('/:id/enhance-pdf', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        const resumeId = parseInt(req.params.id, 10);
        const { jobDescription, template = 'modern' } = req.body;

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

        // Detect language and create enhancement prompt
        const languageInfo = await detectLanguage(jobDescription);
        const prompt: string = `You are an expert resume writer. Enhance the following resume to best match the provided job description. Use strong, relevant language, optimize for ATS, and tailor the summary, work experience, and skills to the job requirements. ${languageInfo.instruction} Return the enhanced resume as structured JSON in the following format:

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
                        { role: 'system', content: 'You are an expert resume writer. Return only valid JSON.' },
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
            message: 'Resume enhanced and saved successfully'
        });
    } catch (error: any) {
        console.error('Error in enhance-pdf endpoint:', error);
        res.status(500).json({ error: 'Failed to enhance resume' });
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

export default router;