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
        isCurrent?: boolean;
        description?: string;
        companyDescription?: string;
        techStack?: string;
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

export async function processSkills(skills: Array<{ id?: number; name: string }>) {
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
    console.log('=== RESUME CREATION DEBUG ===');
    console.log('Input data.workExperience:', JSON.stringify(data.workExperience, null, 2));
    console.log('Work experience count:', data.workExperience?.length || 0);

    const processedSkills = await processSkills(data.skills);
    const processedLanguages = await processLanguages(data.languages);

    // Create work experience data for database
    const workExperienceData = data.workExperience.map((exp, index) => {
        console.log(`Processing work experience ${index + 1}:`, {
            jobTitle: exp.jobTitle,
            company: exp.company,
            startDate: exp.startDate,
            endDate: exp.endDate
        });
        return {
            jobTitle: exp.jobTitle,
            company: exp.company,
            location: exp.location,
            startDate: new Date(exp.startDate),
            endDate: exp.endDate && exp.endDate !== 'Present' ? new Date(exp.endDate) : null,
            description: exp.description,
            companyDescription: exp.companyDescription,
            techStack: exp.techStack,
        };
    });

    console.log('Prepared work experience data for DB:', JSON.stringify(workExperienceData, null, 2));

    try {
        const result = await prisma.resume.create({
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
                    create: workExperienceData,
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
            include: {
                workExperiences: true,
                educations: true,
                certifications: true,
                skills: true,
                languages: true,
            },
        });

        console.log('Resume created with ID:', result.id);
        console.log('Created work experiences count:', result.workExperiences?.length || 0);
        
        return result;
    } catch (error) {
        console.error('Database error creating resume:', error);
        throw error;
    }
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