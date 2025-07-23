import express from 'express';
import { z } from 'zod';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { requirePremium } from '../middleware/subscription';

// Import shared utilities and services
import { prisma } from '../lib/database';
import { parseDate } from '../utils/dates';
import { DateTimeSchema } from '../utils/validation';
import { 
    handleValidationError, 
    handleDatabaseError, 
    handleUnauthorized, 
    handleNotFound 
} from '../utils/errorHandling';

const router = express.Router();

// Validation schemas using shared components
const JobCreateSchema = z.object({
    position: z.string().min(1, 'Job position is required'),
    company: z.string().min(1, 'Company is required'),
    location: z.string().min(1, 'Location is required'),
    maxSalary: z.number().positive().optional(),
    status: z.string().optional(),
    deadline: DateTimeSchema,
    dateApplied: DateTimeSchema,
    followUp: DateTimeSchema,
    comment: z.string().optional(),
    jobUrl: z.string().url().optional(),
    description: z.string().optional(),
    notes: z.string().optional(),
    interviewDate: DateTimeSchema,
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
    deadline: DateTimeSchema,
    dateApplied: DateTimeSchema,
    followUp: DateTimeSchema,
    comment: z.string().optional(),
    jobUrl: z.string().url().optional(),
    description: z.string().optional(),
    notes: z.string().optional(),
    interviewDate: DateTimeSchema,
    contactPerson: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
});

// POST /api/jobs - Create a new job application
router.post('/', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const parsed = JobCreateSchema.parse(req.body);
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
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// GET /api/jobs - List all job applications for the authenticated user
router.get('/', ensureAuthenticated, requirePremium, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const jobs = await prisma.job.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
        });

        res.json(jobs);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch jobs');
    }
}));

// GET /api/jobs/stats/overview - Get job application statistics
router.get('/stats/overview', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const jobs = await prisma.job.findMany({ where: { userId } });
        const total = jobs.length;

        const applied = jobs.filter((j: any) => j.status === 'applied').length;
        const interviewing = jobs.filter((j: any) => j.status === 'interviewing').length;
        const rejected = jobs.filter((j: any) => j.status === 'rejected').length;
        const offer = jobs.filter((j: any) => j.status === 'offer').length;
        const withdrawn = jobs.filter((j: any) => j.status === 'withdrawn').length;
        const pending = jobs.filter((j: any) => j.status === 'pending').length;
        const followUp = jobs.filter((j: any) => j.status === 'follow-up').length;

        // Response rate: percentage of applications with interviewing, offer, pending, or follow-up status
        const responseCounts = interviewing + offer + pending + followUp;
        const responseRate = total > 0 ? (responseCounts / total) * 100 : 0;
        const interviewRate = total > 0 ? (interviewing / total) * 100 : 0;
        const offerRate = total > 0 ? (offer / total) * 100 : 0;

        const stats = {
            total,
            applied,
            interviewing,
            rejected,
            offer,
            withdrawn,
            pending,
            followUp,
            responseRate,
            interviewRate,
            offerRate,
        };

        return res.json(stats);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch job statistics');
    }
}));

// GET /api/jobs/status/:status - Get jobs filtered by status
router.get('/status/:status', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const { status } = req.params;

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const jobs = await prisma.job.findMany({
            where: { userId, status },
            orderBy: { updatedAt: 'desc' },
        });

        res.json(jobs);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch jobs by status');
    }
}));

// GET /api/jobs/follow-ups - Get jobs that need follow-up
router.get('/follow-ups', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const now = new Date();
        const jobs = await prisma.job.findMany({
            where: {
                userId,
                followUp: {
                    lte: now,
                },
            },
            orderBy: { followUp: 'asc' },
        });

        res.json(jobs);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch follow-up jobs');
    }
}));

// GET /api/jobs/deadlines - Get jobs with upcoming deadlines
router.get('/deadlines', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const now = new Date();
        const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const jobs = await prisma.job.findMany({
            where: {
                userId,
                deadline: {
                    gte: now,
                    lte: oneWeekFromNow,
                },
            },
            orderBy: { deadline: 'asc' },
        });

        res.json(jobs);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch jobs with deadlines');
    }
}));

// GET /api/jobs/:id - Get a specific job application
router.get('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const jobId = parseInt(req.params.id, 10);

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }

    try {
        const job = await prisma.job.findFirst({
            where: { id: jobId, userId },
        });

        if (!job) {
            handleNotFound(res, 'Job application');
            return;
        }

        res.json(job);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch job');
    }
}));

// PUT /api/jobs/:id - Update a specific job application
router.put('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const jobId = parseInt(req.params.id, 10);

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }

    try {
        const parsed = JobUpdateSchema.parse(req.body);
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

        // Check if job exists and belongs to user
        const existingJob = await prisma.job.findFirst({
            where: { id: jobId, userId },
        });

        if (!existingJob) {
            handleNotFound(res, 'Job application');
            return;
        }

        const updatedJob = await prisma.job.update({
            where: { id: jobId },
            data: {
                ...(position !== undefined && { position }),
                ...(company !== undefined && { company }),
                ...(location !== undefined && { location }),
                ...(maxSalary !== undefined && { maxSalary }),
                ...(status !== undefined && { status }),
                ...(deadline !== undefined && { deadline: parseDate(deadline) }),
                ...(dateApplied !== undefined && { dateApplied: parseDate(dateApplied) }),
                ...(followUp !== undefined && { followUp: parseDate(followUp) }),
                ...(comment !== undefined && { comment }),
                ...(jobUrl !== undefined && { jobUrl }),
                ...(description !== undefined && { description }),
                ...(notes !== undefined && { notes }),
                ...(interviewDate !== undefined && { interviewDate: parseDate(interviewDate) }),
                ...(contactPerson !== undefined && { contactPerson }),
                ...(contactEmail !== undefined && { contactEmail }),
                ...(contactPhone !== undefined && { contactPhone }),
            },
        });

        res.json(updatedJob);
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// DELETE /api/jobs/:id - Delete a specific job application
router.delete('/:id', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const jobId = parseInt(req.params.id, 10);

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }

    try {
        // Check if job exists and belongs to user
        const existingJob = await prisma.job.findFirst({
            where: { id: jobId, userId },
        });

        if (!existingJob) {
            handleNotFound(res, 'Job application');
            return;
        }

        await prisma.job.delete({
            where: { id: jobId },
        });

        res.status(204).send();
    } catch (error) {
        handleDatabaseError(error, res, 'delete job');
    }
}));

export default router; 