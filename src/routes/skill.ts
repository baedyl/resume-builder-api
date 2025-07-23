import { Request, Response, Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';

// Import shared utilities and services
import { prisma } from '../lib/database';
import { handleDatabaseError } from '../utils/errorHandling';

const router = Router();

// GET /api/skills
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
    try {
        const skills = await prisma.skill.findMany();
        res.json(skills);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch skills');
    }
}));

export default router;