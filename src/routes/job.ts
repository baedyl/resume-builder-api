import express from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { requirePremium } from '../middleware/subscription';

const prisma = new PrismaClient();
const router = express.Router();

// Validation schemas
const JobCreateSchema = z.object({
    position: z.string().min(1, 'Job position is required'),
    company: z.string().min(1, 'Company is required'),
    location: z.string().min(1, 'Location is required'),
    maxSalary: z.number().positive().optional(),
    status: z.string().optional(),
    deadline: z.string().datetime().optional(),
    dateApplied: z.string().datetime().optional(),
    followUp: z.string().datetime().optional(),
    comment: z.string().optional(),
    jobUrl: z.string().url().optional(),
    description: z.string().optional(),
    notes: z.string().optional(),
    interviewDate: z.string().datetime().optional(),
    contactPerson: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
});

const JobUpdateSchema = z.object({
    position: z.string().min(1, 'Job position is required').optional(),
    company: z.string().min(1, 'Company is required').optional(),
    location: z.string().min(1, 'Location is required').optional(),
    maxSalary: z.number().positive().optional(),
    status: z.string().optional(),
    deadline: z.string().datetime().optional(),
    dateApplied: z.string().datetime().optional(),
    followUp: z.string().datetime().optional(),
    comment: z.string().optional(),
    jobUrl: z.string().url().optional(),
    description: z.string().optional(),
    notes: z.string().optional(),
    interviewDate: z.string().datetime().optional(),
    contactPerson: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
});

// Helper function to parse date strings
const parseDate = (dateString?: string): Date | undefined => {
    if (!dateString) return undefined;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? undefined : date;
};

// POST /api/jobs - Create a new job application
router.post('/', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    let parsed;
    try {
        parsed = JobCreateSchema.parse(req.body);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to create job application' });
    }

    const {
        position,
        company,
        location,
        maxSalary,
        status,
        deadline,
        dateApplied,
        followUp,
        comment,
        jobUrl,
        description,
        notes,
        interviewDate,
        contactPerson,
        contactEmail,
        contactPhone
    } = parsed;

    const job = await prisma.job.create({
        data: {
            userId,
            position,
            company,
            location,
            maxSalary,
            status,
            deadline: parseDate(deadline),
            dateApplied: parseDate(dateApplied),
            followUp: parseDate(followUp),
            comment,
            jobUrl,
            description,
            notes,
            interviewDate: parseDate(interviewDate),
            contactPerson,
            contactEmail,
            contactPhone,
        },
    });

    return res.status(201).json(job);
}));

// GET /api/jobs - List all job applications for the current user
router.get('/', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const jobs = await prisma.job.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
    });

    return res.json(jobs);
}));

// GET /api/jobs/:id - Get a specific job application
router.get('/get/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const id = parseInt(req.params.id, 10);

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid job ID' });

    const job = await prisma.job.findFirst({
        where: { id, userId },
    });

    if (!job) return res.status(404).json({ error: 'Job application not found' });

    return res.json(job);
}));

// PUT /api/jobs/:id - Update a specific job application
router.put('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const id = parseInt(req.params.id, 10);

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid job ID' });

    const existing = await prisma.job.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Job application not found' });

    let data;
    try {
        data = JobUpdateSchema.parse(req.body);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        return res.status(500).json({ error: 'Failed to update job application' });
    }

    // Parse date fields if provided
    const updateData: any = { ...data };
    if (data.deadline !== undefined) updateData.deadline = parseDate(data.deadline);
    if (data.dateApplied !== undefined) updateData.dateApplied = parseDate(data.dateApplied);
    if (data.followUp !== undefined) updateData.followUp = parseDate(data.followUp);
    if (data.interviewDate !== undefined) updateData.interviewDate = parseDate(data.interviewDate);

    const updated = await prisma.job.update({
        where: { id },
        data: updateData,
    });

    return res.json(updated);
}));

// DELETE /api/jobs/:id - Delete a specific job application
router.delete('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const id = parseInt(req.params.id, 10);

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid job ID' });

    const existing = await prisma.job.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Job application not found' });

    await prisma.job.delete({ where: { id } });

    return res.status(204).send();
}));

// GET /api/jobs/stats - Get job application statistics
router.get('/stats/overview', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [totalJobs, appliedJobs, interviewJobs, rejectedJobs, acceptedJobs, withdrawnJobs, pendingJobs, followUpJobs] = await Promise.all([
        prisma.job.count({ where: { userId } }),
        prisma.job.count({ where: { userId, status: 'applied' } }),
        prisma.job.count({ where: { userId, status: 'interviewing' } }),
        prisma.job.count({ where: { userId, status: 'rejected' } }),
        prisma.job.count({ where: { userId, status: 'offer' } }),
        prisma.job.count({ where: { userId, status: 'withdrawn' } }),
        prisma.job.count({ where: { userId, status: 'pending' } }),
        prisma.job.count({ where: { userId, status: 'follow-up' } }),
    ]);

    // Rates
    const responded = totalJobs > 0 ? interviewJobs + acceptedJobs + pendingJobs : 0;
    const responseRate = totalJobs > 0 ? (responded / totalJobs) * 100 : 0;
    const interviewRate = totalJobs > 0 ? ((interviewJobs + pendingJobs) / totalJobs) * 100 : 0;
    const offerRate = totalJobs > 0 ? (acceptedJobs / totalJobs) * 100 : 0;

    const stats = {
        total: totalJobs,
        applied: appliedJobs,
        interviewing: interviewJobs,
        rejected: rejectedJobs,
        offer: acceptedJobs,
        withdrawn: withdrawnJobs,
        pending: pendingJobs,
        followUp: followUpJobs,
        responseRate,
        interviewRate,
        offerRate,
    };


    return res.json(stats);
}));

// GET /api/jobs/status/:status - Get jobs by status
router.get('/status/:status', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const status = req.params.status;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const jobs = await prisma.job.findMany({
        where: { userId, status },
        orderBy: { updatedAt: 'desc' },
    });

    return res.json(jobs);
}));

// GET /api/jobs/follow-ups - Get upcoming follow-ups
router.get('/follow-ups', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const followUps = await prisma.job.findMany({
        where: {
            userId,
            followUp: {
                gte: today,
                lte: nextWeek,
            },
        },
        orderBy: { followUp: 'asc' },
    });

    return res.json(followUps);
}));

// GET /api/jobs/deadlines - Get upcoming deadlines
router.get('/deadlines', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const today = new Date();
    const nextMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    const deadlines = await prisma.job.findMany({
        where: {
            userId,
            deadline: {
                gte: today,
                lte: nextMonth,
            },
        },
        orderBy: { deadline: 'asc' },
    });

    return res.json(deadlines);
}));

export default router; 