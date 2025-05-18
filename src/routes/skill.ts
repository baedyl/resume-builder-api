// resume-builder-api/src/routes/skill.ts
import { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// GET /api/skills
router.get('/', async (_req: Request, res: Response) => {
    console.log('Fetching skills at:', new Date().toISOString());
    try {
        const skills = await prisma.skill.findMany();
        console.log('Skills fetched:', skills);
        return res.json(skills);
    } catch (error) {
        console.error('Error fetching skills:', error);
        return res.status(500).json({ error: 'Failed to fetch skills' });
    }
});

// POST /api/skills
router.post('/', async (req: Request, res: Response) => {
    try {
        const { name } = req.body as { name: string };
        if (!name) {
            return res.status(400).json({ error: 'Skill name is required' });
        }
        const skill = await prisma.skill.upsert({
            where: { name },
            update: {},
            create: { name },
        });
        console.log('Skill created/updated:', skill);
        return res.json(skill);
    } catch (error) {
        console.error('Error creating skill:', error);
        return res.status(500).json({ error: 'Failed to create skill' });
    }
});

export default router;