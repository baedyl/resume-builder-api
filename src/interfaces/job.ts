export interface Job {
    id: number;
    userId: string;
    position: string;
    company: string;
    location: string;
    maxSalary?: number;
    status?: string;
    deadline?: Date;
    dateApplied?: Date;
    followUp?: Date;
    comment?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface JobCreateRequest {
    position: string;
    company: string;
    location: string;
    maxSalary?: number;
    status?: string;
    deadline?: string;
    dateApplied?: string;
    followUp?: string;
    comment?: string;
}

export interface JobUpdateRequest {
    position?: string;
    company?: string;
    location?: string;
    maxSalary?: number;
    status?: string;
    deadline?: string;
    dateApplied?: string;
    followUp?: string;
    comment?: string;
}

export interface JobStats {
    total: number;
    applied: number;
    interview: number;
    rejected: number;
    accepted: number;
} 