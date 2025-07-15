import express from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import OpenAI from 'openai';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import PDFDocument from 'pdfkit';

const prisma = new PrismaClient();
const router = express.Router();

const CoverLetterGenerateSchema = z.object({
    jobDescription: z.string().min(1, 'Job description is required'),
    fullName: z.string().optional(),
    email: z.string().email('Invalid email').optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
});

const CoverLetterSchema = z.object({
    content: z.string().min(1, 'Content is required'),
    fullName: z.string().optional(),
    email: z.string().email('Invalid email').optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

router.post('/', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { jobDescription, fullName, email, phone, address } = CoverLetterGenerateSchema.parse(req.body);

        // Compose the prompt for OpenAI
        const prompt = `You are an expert career coach and writer. Write a professional, personalized cover letter for the following job description. Use the provided personal information if available. The letter should be formal, concise, and tailored to the job requirements. Return only the cover letter text, no commentary or markdown.

Job Description:
${jobDescription}

Personal Info:
${fullName ? `Full Name: ${fullName}\n` : ''}${email ? `Email: ${email}\n` : ''}${phone ? `Phone: ${phone}\n` : ''}${address ? `Address: ${address}\n` : ''}`;

        let coverLetterContent = '';
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
                    max_tokens: 800,
                });
                const content = response.choices[0]?.message?.content?.trim();
                if (content && content.length > 0) {
                    coverLetterContent = content;
                    break;
                }
            } catch (apiError) {
                if (attempt === maxRetries) throw apiError;
            }
        }
        if (!coverLetterContent) {
            coverLetterContent = 'Dear Hiring Manager,\n\nI am excited to apply for this position. My background and skills make me a strong fit for the role. I look forward to the opportunity to contribute to your team.\n\nSincerely,\n' + (fullName || '');
        }

        // Save to DB
        const saved = await prisma.coverLetter.create({
            data: {
                userId,
                content: coverLetterContent,
                fullName,
                email,
                phone,
                address,
            },
        });
        return res.json({ coverLetter: coverLetterContent, record: saved });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to generate cover letter' });
    }
}));

// GET /api/cover-letter - List all cover letters for the current user
router.get('/', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const coverLetters = await prisma.coverLetter.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
    });
    return res.json(coverLetters);
}));

// GET /api/cover-letter/:id - Get a specific cover letter
router.get('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const id = parseInt(req.params.id, 10);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid cover letter ID' });
    const coverLetter = await prisma.coverLetter.findFirst({
        where: { id, userId },
    });
    if (!coverLetter) return res.status(404).json({ error: 'Cover letter not found' });
    return res.json(coverLetter);
}));

// PUT /api/cover-letter/:id - Update a specific cover letter
router.put('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const id = parseInt(req.params.id, 10);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid cover letter ID' });
    const existing = await prisma.coverLetter.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Cover letter not found' });
    const data = CoverLetterSchema.parse(req.body);
    const updated = await prisma.coverLetter.update({
        where: { id },
        data,
    });
    return res.json(updated);
}));

// DELETE /api/cover-letter/:id - Delete a specific cover letter
router.delete('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const id = parseInt(req.params.id, 10);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid cover letter ID' });
    const existing = await prisma.coverLetter.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Cover letter not found' });
    await prisma.coverLetter.delete({ where: { id } });
    return res.status(204).send();
}));

// POST /api/cover-letter/:id/pdf - Generate PDF for a specific cover letter
router.post('/:id/pdf', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const id = parseInt(req.params.id, 10);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid cover letter ID' });
    const coverLetter = await prisma.coverLetter.findFirst({ where: { id, userId } });
    if (!coverLetter) return res.status(404).json({ error: 'Cover letter not found' });

    // Generate PDF
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=cover-letter.pdf',
    });
    doc.font('Helvetica-Bold').fontSize(18).text(coverLetter.fullName || '', { align: 'left' });
    doc.moveDown(0.5);
    if (coverLetter.email || coverLetter.phone || coverLetter.address) {
        doc.font('Helvetica').fontSize(11).text([
            coverLetter.email,
            coverLetter.phone,
            coverLetter.address
        ].filter(Boolean).join(' | '), { align: 'left' });
        doc.moveDown(1);
    }
    doc.font('Helvetica').fontSize(12).text(coverLetter.content, { align: 'left', lineGap: 2 });
    doc.end();
    doc.pipe(res);
}));

export default router; 