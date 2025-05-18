// src/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
    const skills = [
        'Python',
        'JavaScript',
        'TypeScript',
        'Communication',
        'Project Management',
        'SQL',
        'Java',
        'Leadership',
    ];
    await prisma.skill.createMany({
        data: skills.map((name) => ({ name })),
        skipDuplicates: true,
    });
    console.log('Skills seeded');
}

seed().finally(() => prisma.$disconnect());