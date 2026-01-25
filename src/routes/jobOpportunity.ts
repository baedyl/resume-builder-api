import express from 'express';
import { z } from 'zod';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { prisma } from '../lib/database';
import { JobMatchingService } from '../services/jobMatchingService';
import { JobSyncService } from '../services/jobSyncService';
import {
    handleValidationError,
    handleDatabaseError,
    handleUnauthorized,
    handleNotFound
} from '../utils/errorHandling';

const router = express.Router();

// Validation schemas
const JobSearchSchema = z.object({
    search: z.string().optional(),
    location: z.string().optional(),
    jobType: z.string().optional(),
    experienceLevel: z.string().optional(),
    skills: z.string().optional(), // comma-separated skill IDs
    salaryMin: z.coerce.number().positive().optional(),
    salaryMax: z.coerce.number().positive().optional(),
    locationType: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20)
});

const JobApplicationSchema = z.object({
    coverLetter: z.string().optional(),
    resumeId: z.number().int().positive().optional(),
    notes: z.string().optional()
});

// GET /api/job-opportunities - Search and list job opportunities
router.get('/', asyncHandler(async (req: any, res) => {
    const query = JobSearchSchema.parse(req.query);

    const where: any = { isActive: true };

    // Text search
    if (query.search) {
        where.OR = [
            { title: { contains: query.search, mode: 'insensitive' } },
            { company: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } }
        ];
    }

    // Filters
    if (query.location) {
        where.location = { contains: query.location, mode: 'insensitive' };
    }
    if (query.jobType) where.jobType = query.jobType;
    if (query.experienceLevel) where.experienceLevel = query.experienceLevel;
    if (query.locationType) where.locationType = query.locationType;
    if (query.salaryMin) where.salaryMin = { gte: query.salaryMin };
    if (query.salaryMax) where.salaryMax = { lte: query.salaryMax };

    // Skills filter
    if (query.skills) {
        const skillIds = query.skills.split(',').map((id: string) => parseInt(id.trim())).filter(id => !isNaN(id));
        if (skillIds.length > 0) {
            where.skills = { some: { skillId: { in: skillIds } } };
        }
    }

    const skip = (query.page - 1) * query.limit;

    const [jobs, total] = await Promise.all([
        prisma.jobOpportunity.findMany({
            where,
            include: {
                skills: { include: { skill: true } },
                _count: { select: { applications: true } }
            },
            skip,
            take: query.limit,
            orderBy: { postedDate: 'desc' }
        }),
        prisma.jobOpportunity.count({ where })
    ]);

    res.json({
        jobs,
        pagination: {
            page: query.page,
            limit: query.limit,
            total,
            pages: Math.ceil(total / query.limit)
        }
    });
}));

// GET /api/job-opportunities/matches - Get jobs matching user's profile
router.get('/matches', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) return handleUnauthorized(res);

    const limit = parseInt(req.query.limit) || 20;
    const matches = await JobMatchingService.findMatchingJobs(userId, limit);

    res.json(matches);
}));

// GET /api/job-opportunities/:id - Get specific job opportunity
router.get('/:id', asyncHandler(async (req, res) => {
    const jobId = parseInt(req.params.id);
    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }

    const job = await prisma.jobOpportunity.findUnique({
        where: { id: jobId },
        include: {
            skills: { include: { skill: true } },
            _count: { select: { applications: true } }
        }
    });

    if (!job) return handleNotFound(res, 'Job opportunity');

    res.json(job);
}));

// POST /api/job-opportunities/:id/apply - Apply to a job
router.post('/:id/apply', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const jobId = parseInt(req.params.id);

    if (!userId) return handleUnauthorized(res);
    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }

    try {
        const parsed = JobApplicationSchema.parse(req.body);
        const { coverLetter, resumeId, notes } = parsed;

        // Check if job exists and is active
        const job = await prisma.jobOpportunity.findUnique({ where: { id: jobId } });
        if (!job || !job.isActive) {
            return handleNotFound(res, 'Job opportunity');
        }

        // Check if user already applied
        const existingApplication = await prisma.jobApplication.findUnique({
            where: { userId_jobOpportunityId: { userId, jobOpportunityId: jobId } }
        });

        if (existingApplication) {
            return res.status(400).json({ error: 'You have already applied to this job' });
        }

        // Validate resume belongs to user if provided
        if (resumeId) {
            const resume = await prisma.resume.findFirst({
                where: { id: resumeId, userId }
            });
            if (!resume) {
                return res.status(400).json({ error: 'Resume not found or does not belong to you' });
            }
        }

        // Create application
        const application = await prisma.jobApplication.create({
            data: {
                userId,
                jobOpportunityId: jobId,
                coverLetter,
                resumeId,
                notes
            },
            include: {
                jobOpportunity: true,
                resume: true
            }
        });

        res.status(201).json(application);
    } catch (error) {
        handleValidationError(error, res);
    }
}));

// GET /api/job-opportunities/:id/applications - Get applications for a job (admin only)
router.get('/:id/applications', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    // TODO: Add admin permission check
    const jobId = parseInt(req.params.id);

    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }

    const applications = await prisma.jobApplication.findMany({
        where: { jobOpportunityId: jobId },
        include: {
            resume: {
                include: {
                    skills: true,
                    workExperiences: true
                }
            }
        },
        orderBy: { appliedAt: 'desc' }
    });

    res.json(applications);
}));

// GET /api/job-opportunities/applications/my - Get user's job applications
router.get('/applications/my', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) return handleUnauthorized(res);

    const applications = await prisma.jobApplication.findMany({
        where: { userId },
        include: {
            jobOpportunity: {
                include: {
                    skills: { include: { skill: true } }
                }
            },
            resume: true
        },
        orderBy: { appliedAt: 'desc' }
    });

    res.json(applications);
}));

// PUT /api/job-opportunities/applications/:applicationId - Update application status
router.put('/applications/:applicationId', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const applicationId = parseInt(req.params.applicationId);

    if (!userId) return handleUnauthorized(res);
    if (isNaN(applicationId)) {
        return res.status(400).json({ error: 'Invalid application ID' });
    }

    const { status, notes } = req.body;

    // Find application and verify ownership
    const application = await prisma.jobApplication.findFirst({
        where: { id: applicationId, userId },
        include: { jobOpportunity: true }
    });

    if (!application) {
        return handleNotFound(res, 'Job application');
    }

    // Update application
    const updatedApplication = await prisma.jobApplication.update({
        where: { id: applicationId },
        data: { status, notes },
        include: { jobOpportunity: true, resume: true }
    });

    res.json(updatedApplication);
}));

// POST /api/job-opportunities/sync - Trigger manual job sync (admin only)
router.post('/sync', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    // TODO: Add admin permission check

    try {
        const result = await JobSyncService.syncJobsFromAllSources();
        res.json({
            message: 'Job sync completed',
            ...result
        });
    } catch (error) {
        console.error('Job sync failed:', error);
        res.status(500).json({ error: 'Job sync failed' });
    }
}));

// GET /api/job-opportunities/sources - Get job source statistics
router.get('/sources/stats', asyncHandler(async (req, res) => {
    const sources = await prisma.jobSource.findMany();

    const stats = await prisma.jobOpportunity.groupBy({
        by: ['source'],
        _count: { id: true },
        where: { isActive: true }
    });

    // Get recent sync activity
    const recentJobs = await prisma.jobOpportunity.findMany({
        where: {
            createdAt: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
            }
        },
        select: {
            source: true,
            createdAt: true
        }
    });

    res.json({
        sources,
        stats,
        recentActivity: recentJobs.length,
        lastSync: sources.length > 0 ? Math.max(...sources.map(s => s.lastSync?.getTime() || 0)) : null
    });
}));

// GET /api/job-opportunities/skills/popular - Get popular skills in job postings
router.get('/skills/popular', asyncHandler(async (req: any, res) => {
    const limit = parseInt(req.query.limit as string) || 20;

    const popularSkills = await prisma.jobOpportunitySkill.groupBy({
        by: ['skillId'],
        _count: { skillId: true },
        where: {
            jobOpportunity: { isActive: true }
        },
        orderBy: { _count: { skillId: 'desc' } },
        take: limit
    });

    // Get skill details
    const skillIds = popularSkills.map(s => s.skillId);
    const skills = await prisma.skill.findMany({
        where: { id: { in: skillIds } }
    });

    const result = popularSkills.map(skillGroup => {
        const skill = skills.find(s => s.id === skillGroup.skillId);
        return {
            skill,
            count: skillGroup._count.skillId
        };
    });

    res.json(result);
}));

export default router;
