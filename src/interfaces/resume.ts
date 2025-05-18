export interface Skill {
    id: number;
    name: string;
}

export interface Resume {
    fullName: string;
    email: string;
    phone?: string;
    address?: string;
    linkedIn?: string;
    summary?: string;
    skills: Skill[];
    // Add workExperiences, educations, certifications later
}