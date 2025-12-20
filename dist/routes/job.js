"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const asyncHandler_1 = require("../utils/asyncHandler");
const subscription_1 = require("../middleware/subscription");
// Import shared utilities and services
const database_1 = require("../lib/database");
const dates_1 = require("../utils/dates");
const validation_1 = require("../utils/validation");
const errorHandling_1 = require("../utils/errorHandling");
const router = express_1.default.Router();
// Validation schemas using shared components
const JobCreateSchema = zod_1.z.object({
    position: zod_1.z.string().min(1, 'Job position is required'),
    company: zod_1.z.string().min(1, 'Company is required'),
    location: zod_1.z.string().min(1, 'Location is required'),
    maxSalary: zod_1.z.number().positive().optional(),
    status: zod_1.z.string().optional(),
    deadline: validation_1.DateTimeSchema,
    dateApplied: validation_1.DateTimeSchema,
    followUp: validation_1.DateTimeSchema,
    comment: zod_1.z.string().optional(),
    jobUrl: zod_1.z.string().url().optional(),
    description: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    interviewDate: validation_1.DateTimeSchema,
    contactPerson: zod_1.z.string().optional(),
    contactEmail: zod_1.z.string().email().optional(),
    contactPhone: zod_1.z.string().optional(),
});
const JobUpdateSchema = zod_1.z.object({
    position: zod_1.z.string().min(1, 'Job position is required').optional(),
    company: zod_1.z.string().min(1, 'Company is required').optional(),
    location: zod_1.z.string().min(1, 'Location is required').optional(),
    maxSalary: zod_1.z.number().positive().optional(),
    status: zod_1.z.string().optional(),
    deadline: validation_1.DateTimeSchema,
    dateApplied: validation_1.DateTimeSchema,
    followUp: validation_1.DateTimeSchema,
    comment: zod_1.z.string().optional(),
    jobUrl: zod_1.z.string().url().optional(),
    description: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    interviewDate: validation_1.DateTimeSchema,
    contactPerson: zod_1.z.string().optional(),
    contactEmail: zod_1.z.string().email().optional(),
    contactPhone: zod_1.z.string().optional(),
});
// POST /api/jobs - Create a new job application
router.post('/', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    try {
        const parsed = JobCreateSchema.parse(req.body);
        const { position, company, location, maxSalary, status, deadline, dateApplied, followUp, comment, jobUrl, description, notes, interviewDate, contactPerson, contactEmail, contactPhone } = parsed;
        const job = await database_1.prisma.job.create({
            data: {
                userId,
                position,
                company,
                location,
                maxSalary,
                status,
                deadline: (0, dates_1.parseDate)(deadline),
                dateApplied: (0, dates_1.parseDate)(dateApplied),
                followUp: (0, dates_1.parseDate)(followUp),
                comment,
                jobUrl,
                description,
                notes,
                interviewDate: (0, dates_1.parseDate)(interviewDate),
                contactPerson,
                contactEmail,
                contactPhone,
            },
        });
        return res.status(201).json(job);
    }
    catch (error) {
        (0, errorHandling_1.handleValidationError)(error, res);
    }
}));
// GET /api/jobs - List all job applications for the authenticated user
router.get('/', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    try {
        const jobs = await database_1.prisma.job.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
        });
        res.json(jobs);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch jobs');
    }
}));
// GET /api/jobs/stats/overview - Get job application statistics
router.get('/stats/overview', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    try {
        const jobs = await database_1.prisma.job.findMany({ where: { userId } });
        const total = jobs.length;
        const applied = jobs.filter((j) => j.status === 'applied').length;
        const interviewing = jobs.filter((j) => j.status === 'interviewing').length;
        const rejected = jobs.filter((j) => j.status === 'rejected').length;
        const offer = jobs.filter((j) => j.status === 'offer').length;
        const withdrawn = jobs.filter((j) => j.status === 'withdrawn').length;
        const pending = jobs.filter((j) => j.status === 'pending').length;
        const followUp = jobs.filter((j) => j.status === 'follow-up').length;
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
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch job statistics');
    }
}));
// GET /api/jobs/status/:status - Get jobs filtered by status
router.get('/status/:status', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    const { status } = req.params;
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    try {
        const jobs = await database_1.prisma.job.findMany({
            where: { userId, status },
            orderBy: { updatedAt: 'desc' },
        });
        res.json(jobs);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch jobs by status');
    }
}));
// GET /api/jobs/follow-ups - Get jobs that need follow-up
router.get('/follow-ups', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    try {
        const now = new Date();
        const jobs = await database_1.prisma.job.findMany({
            where: {
                userId,
                followUp: {
                    lte: now,
                },
            },
            orderBy: { followUp: 'asc' },
        });
        res.json(jobs);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch follow-up jobs');
    }
}));
// GET /api/jobs/deadlines - Get jobs with upcoming deadlines
router.get('/deadlines', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    try {
        const now = new Date();
        const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const jobs = await database_1.prisma.job.findMany({
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
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch jobs with deadlines');
    }
}));
// GET /api/jobs/:id - Get a specific job application
router.get('/:id', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    const jobId = parseInt(req.params.id, 10);
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }
    try {
        const job = await database_1.prisma.job.findFirst({
            where: { id: jobId, userId },
        });
        if (!job) {
            (0, errorHandling_1.handleNotFound)(res, 'Job application');
            return;
        }
        res.json(job);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch job');
    }
}));
// PUT /api/jobs/:id - Update a specific job application
router.put('/:id', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    const jobId = parseInt(req.params.id, 10);
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }
    try {
        const parsed = JobUpdateSchema.parse(req.body);
        const { position, company, location, maxSalary, status, deadline, dateApplied, followUp, comment, jobUrl, description, notes, interviewDate, contactPerson, contactEmail, contactPhone } = parsed;
        // Check if job exists and belongs to user
        const existingJob = await database_1.prisma.job.findFirst({
            where: { id: jobId, userId },
        });
        if (!existingJob) {
            (0, errorHandling_1.handleNotFound)(res, 'Job application');
            return;
        }
        const updatedJob = await database_1.prisma.job.update({
            where: { id: jobId },
            data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (position !== undefined && { position })), (company !== undefined && { company })), (location !== undefined && { location })), (maxSalary !== undefined && { maxSalary })), (status !== undefined && { status })), (deadline !== undefined && { deadline: (0, dates_1.parseDate)(deadline) })), (dateApplied !== undefined && { dateApplied: (0, dates_1.parseDate)(dateApplied) })), (followUp !== undefined && { followUp: (0, dates_1.parseDate)(followUp) })), (comment !== undefined && { comment })), (jobUrl !== undefined && { jobUrl })), (description !== undefined && { description })), (notes !== undefined && { notes })), (interviewDate !== undefined && { interviewDate: (0, dates_1.parseDate)(interviewDate) })), (contactPerson !== undefined && { contactPerson })), (contactEmail !== undefined && { contactEmail })), (contactPhone !== undefined && { contactPhone })),
        });
        res.json(updatedJob);
    }
    catch (error) {
        (0, errorHandling_1.handleValidationError)(error, res);
    }
}));
// DELETE /api/jobs/:id - Delete a specific job application
router.delete('/:id', auth_1.ensureAuthenticated, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    const jobId = parseInt(req.params.id, 10);
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    if (isNaN(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID' });
    }
    try {
        // Check if job exists and belongs to user
        const existingJob = await database_1.prisma.job.findFirst({
            where: { id: jobId, userId },
        });
        if (!existingJob) {
            (0, errorHandling_1.handleNotFound)(res, 'Job application');
            return;
        }
        await database_1.prisma.job.delete({
            where: { id: jobId },
        });
        res.status(204).send();
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'delete job');
    }
}));
exports.default = router;
