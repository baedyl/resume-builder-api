import express from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import OpenAI from 'openai';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const prisma = new PrismaClient();
const router = express.Router();

const CoverLetterGenerateSchema = z.object({
    jobDescription: z.string().min(1, 'Job description is required'),
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

export default router; 