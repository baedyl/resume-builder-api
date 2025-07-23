import { prisma } from '../lib/database';
import { parseDate } from '../utils/dates';

export interface ResumeData {
    userId: string;
    fullName: string;
    email: string;
    phone?: string;
    address?: string;
    linkedIn?: string;
    website?: string;
    summary?: string;
    skills: Array<{ id?: number; name: string }>;
    languages: Array<{ name: string; proficiency: string }>;
    workExperience: Array<{
        jobTitle: string;
        company: string;
        location?: string;
        startDate: string;
        endDate?: string;
        description?: string;
    }>;
    education: Array<{
        degree: string;
        major?: string;
        institution: string;
        graduationYear?: number;
        gpa?: number;
        description?: string;
    }>;
    certifications: Array<{
        name: string;
        issuer: string;
        issueDate?: string;
    }>;
}

export async function processSkills(skills: Array<{ name: string }>) {
    return Promise.all(
        skills.map(async (skill) => {
            return prisma.skill.upsert({
                where: { name: skill.name },
                update: {},
                create: { name: skill.name },
            });
        })
    );
}

export async function processLanguages(languages: Array<{ name: string; proficiency: string }>) {
    return Promise.all(
        languages.map(async (lang) => {
            return prisma.language.upsert({
                where: { name_proficiency: { name: lang.name, proficiency: lang.proficiency } },
                update: {},
                create: { name: lang.name, proficiency: lang.proficiency },
            });
        })
    );
}

export async function createResume(data: ResumeData) {
    const processedSkills = await processSkills(data.skills);
    const processedLanguages = await processLanguages(data.languages);

    return prisma.resume.create({
        data: {
            userId: data.userId,
            fullName: data.fullName,
            email: data.email,
            phone: data.phone,
            address: data.address,
            linkedIn: data.linkedIn,
            website: data.website,
            summary: data.summary,
            skills: { connect: processedSkills.map((skill) => ({ id: skill.id })) },
            languages: { connect: processedLanguages.map((lang) => ({ id: lang.id })) },
            workExperiences: {
                create: data.workExperience.map((exp) => ({
                    jobTitle: exp.jobTitle,
                    company: exp.company,
                    location: exp.location,
                    startDate: new Date(exp.startDate),
                    endDate: exp.endDate ? new Date(exp.endDate) : null,
                    description: exp.description,
                })),
            },
            educations: {
                create: data.education.map((edu) => ({
                    degree: edu.degree,
                    major: edu.major,
                    institution: edu.institution,
                    graduationYear: edu.graduationYear,
                    gpa: edu.gpa,
                    description: edu.description,
                })),
            },
            certifications: {
                create: data.certifications.map((cert) => ({
                    name: cert.name,
                    issuer: cert.issuer,
                    issueDate: cert.issueDate ? new Date(cert.issueDate) : null,
                })),
            },
        },
    });
}

export async function getResumeById(id: number, userId: string) {
    return prisma.resume.findFirst({
        where: { id, userId },
        include: {
            skills: true,
            languages: true,
            workExperiences: true,
            educations: true,
            certifications: true,
        },
    });
}

export async function getUserResumes(userId: string) {
    return prisma.resume.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
    });
} 