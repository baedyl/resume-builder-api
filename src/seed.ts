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

    // Sample job applications for testing
    const sampleJobs = [
        {
            userId: 'test-user-1',
            position: 'Senior Software Engineer',
            company: 'Tech Corp',
            location: 'San Francisco, CA',
            maxSalary: 150000,
            status: 'Applied',
            dateApplied: new Date('2024-01-10'),
            followUp: new Date('2024-01-17'),
            comment: 'Applied through company website'
        },
        {
            userId: 'test-user-1',
            position: 'Frontend Developer',
            company: 'Startup Inc',
            location: 'Remote',
            maxSalary: 120000,
            status: 'Interview',
            dateApplied: new Date('2024-01-05'),
            followUp: new Date('2024-01-12'),
            comment: 'First interview scheduled for next week'
        },
        {
            userId: 'test-user-1',
            position: 'Full Stack Developer',
            company: 'Enterprise Solutions',
            location: 'New York, NY',
            maxSalary: 130000,
            status: 'Rejected',
            dateApplied: new Date('2024-01-01'),
            comment: 'Position filled internally'
        },
        {
            userId: 'test-user-1',
            position: 'DevOps Engineer',
            company: 'Cloud Tech',
            location: 'Austin, TX',
            maxSalary: 140000,
            status: 'Applied',
            deadline: new Date('2024-02-01'),
            dateApplied: new Date('2024-01-15'),
            comment: 'Great company culture, good benefits'
        }
    ];

    await prisma.job.createMany({
        data: sampleJobs,
        skipDuplicates: true,
    });
    console.log('Sample jobs seeded');
}

seed().finally(() => prisma.$disconnect());