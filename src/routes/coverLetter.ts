import express from 'express';
import { z } from 'zod';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import PDFDocument from 'pdfkit';
import { requirePremium } from '../middleware/subscription';

// Import shared utilities and services
import { prisma } from '../lib/database';
import { detectLanguage } from '../utils/language';
import { enhanceWithOpenAI } from '../utils/openai';
import { ContactInfoSchema } from '../utils/validation';
import { 
    handleValidationError, 
    handleDatabaseError, 
    handleUnauthorized, 
    handleNotFound 
} from '../utils/errorHandling';

const router = express.Router();

// Validation schemas using shared components
const CoverLetterGenerateSchema = z.object({
    jobDescription: z.string().min(1, 'Job description is required'),
}).merge(ContactInfoSchema);

const CoverLetterSchema = z.object({
    content: z.string().min(1, 'Content is required'),
}).merge(ContactInfoSchema);

// POST /api/cover-letter - Generate and save a new cover letter
router.post('/', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const parsed = CoverLetterGenerateSchema.parse(req.body);
        const { jobDescription, fullName, email, phone, address } = parsed;

        // Detect language and generate cover letter
        const languageInfo = await detectLanguage(jobDescription);
        
        // Set system message based on language
        let systemMessage = 'You are a helpful assistant.';
        if (languageInfo.code === 'fr') systemMessage = 'Vous êtes un assistant utile.';
        else if (languageInfo.code === 'es') systemMessage = 'Eres un asistente útil.';

        const prompt = `Write a professional cover letter for the following job description. Use the provided personal information if available. ${languageInfo.instruction}

Job Description:
${jobDescription}

Personal Information:
- Name: ${fullName || 'Not provided'}
- Email: ${email || 'Not provided'}
- Phone: ${phone || 'Not provided'}
- Address: ${address || 'Not provided'}

Please write a compelling, professional cover letter that highlights relevant skills and experience.`;

        // Create language-appropriate fallback content
        const fallbackContent = languageInfo.code === 'es' 
            ? 'Estimado Gerente de Contratación,\n\nLe escribo para expresar mi interés en la posición descrita. Con mi formación y experiencia, creo que sería una valiosa adición a su equipo.\n\nGracias por su consideración.\n\nAtentamente,\n[Su Nombre]'
            : languageInfo.code === 'fr'
            ? 'Cher Responsable du Recrutement,\n\nJe vous écris pour exprimer mon intérêt pour le poste décrit. Avec ma formation et mon expérience, je pense que je serais un ajout précieux à votre équipe.\n\nMerci pour votre considération.\n\nCordialement,\n[Votre Nom]'
            : 'Dear Hiring Manager,\n\nI am writing to express my interest in the position described. With my background and experience, I believe I would be a valuable addition to your team.\n\nThank you for your consideration.\n\nSincerely,\n[Your Name]';

        const content = await enhanceWithOpenAI(
            prompt,
            systemMessage,
            fallbackContent
        );

        // Save cover letter to database
        const coverLetter = await prisma.coverLetter.create({
            data: {
                userId,
                content,
                fullName,
                email,
                phone,
                address,
            },
        });

        res.status(201).json(coverLetter);
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// GET /api/cover-letter - List all cover letters for the authenticated user
router.get('/', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const coverLetters = await prisma.coverLetter.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
        });

        res.json(coverLetters);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch cover letters');
    }
}));

// GET /api/cover-letter/:id - Get a specific cover letter
router.get('/:id', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const coverLetterId = parseInt(req.params.id, 10);

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    if (isNaN(coverLetterId)) {
        return res.status(400).json({ error: 'Invalid cover letter ID' });
    }

    try {
        const coverLetter = await prisma.coverLetter.findFirst({
            where: { id: coverLetterId, userId },
        });

        if (!coverLetter) {
            handleNotFound(res, 'Cover letter');
            return;
        }

        res.json(coverLetter);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch cover letter');
    }
}));

// PUT /api/cover-letter/:id - Update a specific cover letter
router.put('/:id', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const coverLetterId = parseInt(req.params.id, 10);

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    if (isNaN(coverLetterId)) {
        return res.status(400).json({ error: 'Invalid cover letter ID' });
    }

    try {
        const parsed = CoverLetterSchema.parse(req.body);
        const { content, fullName, email, phone, address } = parsed;

        // Check if cover letter exists and belongs to user
        const existingCoverLetter = await prisma.coverLetter.findFirst({
            where: { id: coverLetterId, userId },
        });

        if (!existingCoverLetter) {
            handleNotFound(res, 'Cover letter');
            return;
        }

        const updatedCoverLetter = await prisma.coverLetter.update({
            where: { id: coverLetterId },
            data: {
                content,
                fullName,
                email,
                phone,
                address,
            },
        });

        res.json(updatedCoverLetter);
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// DELETE /api/cover-letter/:id - Delete a specific cover letter
router.delete('/:id', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const coverLetterId = parseInt(req.params.id, 10);

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    if (isNaN(coverLetterId)) {
        return res.status(400).json({ error: 'Invalid cover letter ID' });
    }

    try {
        // Check if cover letter exists and belongs to user
        const existingCoverLetter = await prisma.coverLetter.findFirst({
            where: { id: coverLetterId, userId },
        });

        if (!existingCoverLetter) {
            handleNotFound(res, 'Cover letter');
            return;
        }

        await prisma.coverLetter.delete({
            where: { id: coverLetterId },
        });

        res.status(204).send();
    } catch (error) {
        handleDatabaseError(error, res, 'delete cover letter');
    }
}));

// POST /api/cover-letter/:id/pdf - Generate PDF for a specific cover letter
router.post('/:id/pdf', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const coverLetterId = parseInt(req.params.id, 10);

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    if (isNaN(coverLetterId)) {
        return res.status(400).json({ error: 'Invalid cover letter ID' });
    }

    try {
        const coverLetter = await prisma.coverLetter.findFirst({
            where: { id: coverLetterId, userId },
        });

        if (!coverLetter) {
            handleNotFound(res, 'Cover letter');
            return;
        }

        // Generate PDF
        const doc = new PDFDocument({
            size: 'LETTER',
            margins: {
                top: 50,
                bottom: 50,
                left: 50,
                right: 50
            }
        });

        // Header with personal information
        if (coverLetter.fullName) {
            doc.font('Helvetica-Bold')
               .fontSize(16)
               .text(coverLetter.fullName, { align: 'center' });
            doc.moveDown(0.5);
        }

        const contactInfo = [
            coverLetter.email,
            coverLetter.phone,
            coverLetter.address,
        ].filter(Boolean).join(' • ');

        if (contactInfo) {
            doc.font('Helvetica')
               .fontSize(11)
               .text(contactInfo, { align: 'center' });
            doc.moveDown(1);
        }

        // Current date
        const currentDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        doc.font('Helvetica')
           .fontSize(11)
           .text(currentDate, { align: 'right' });
        doc.moveDown(2);

        // Cover letter content
        doc.font('Helvetica')
           .fontSize(11)
           .text(coverLetter.content, {
               align: 'justify',
               lineGap: 3
           });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="cover-letter.pdf"');

        doc.pipe(res);
        doc.end();
    } catch (error) {
        handleDatabaseError(error, res, 'generate cover letter PDF');
    }
}));

export default router; 