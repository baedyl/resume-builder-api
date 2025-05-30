import { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler'; // Adjust the path based on your project structure

const prisma = new PrismaClient();
const router = Router();

// GET /api/skills
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
    console.log('Fetching skills at:', new Date().toISOString());
    try {
        const skills = await prisma.skill.findMany();
        console.log('Skills fetched:', skills);
        res.json(skills); // No 'return' here
    } catch (error) {
        console.error('Error fetching skills:', error);
        res.status(500).json({ error: 'Failed to fetch skills' }); // No 'return' here
    }
}));

// POST /api/skills
router.post('/', asyncHandler(async (req: any, res) => {
    try {
        const { name } = req.body as { name: string };
        if (!name) {
            res.status(400).json({ error: 'Skill name is required' });
            return; // Keep 'return' for early exit
        }
        const skill = await prisma.skill.upsert({
            where: { name },
            update: {},
            create: { name },
        });
        console.log('Skill created/updated:', skill);
        res.json(skill); // No 'return' here
    } catch (error) {
        console.error('Error creating skill:', error);
        res.status(500).json({ error: 'Failed to create skill' }); // No 'return' here
    }
}));

export default router;