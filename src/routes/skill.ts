// src/routes/skill.ts
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

router.get('/', async (req: Request, res: Response) => {
    try {
        const skills = await prisma.skill.findMany();
        res.json(skills);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch skills' });
    }
});

export default router;