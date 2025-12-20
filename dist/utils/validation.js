"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DateTimeSchema = exports.ContactInfoSchema = exports.CertificationSchema = exports.LanguageSchema = exports.SkillSchema = exports.EducationSchema = exports.WorkExperienceSchema = void 0;
const zod_1 = require("zod");
// Common schemas used across multiple routes
exports.WorkExperienceSchema = zod_1.z.object({
    jobTitle: zod_1.z.string().min(1, 'Job title is required'),
    company: zod_1.z.string().min(1, 'Company is required'),
    location: zod_1.z.string().optional(),
    startDate: zod_1.z.string().min(1, 'Start date is required'),
    endDate: zod_1.z.string().optional(),
    isCurrent: zod_1.z.boolean().optional(),
    description: zod_1.z.string().optional(),
    companyDescription: zod_1.z.string().optional(),
    techStack: zod_1.z.string().optional(),
});
exports.EducationSchema = zod_1.z.object({
    degree: zod_1.z.string().min(1, 'Degree is required'),
    major: zod_1.z.string().optional(),
    institution: zod_1.z.string().min(1, 'Institution is required'),
    startYear: zod_1.z.preprocess((val) => {
        if (val === '' || val === null || typeof val === 'undefined')
            return undefined;
        if (typeof val === 'string') {
            const n = parseInt(val, 10);
            return Number.isNaN(n) ? val : n;
        }
        return val;
    }, zod_1.z.number().int().min(1900, 'Start year must be a valid year').max(9999, 'Start year must be a valid year')).optional(),
    graduationYear: zod_1.z.number().int().min(1900, 'Graduation year must be a valid year').max(9999, 'Graduation year must be a valid year').optional(),
    gpa: zod_1.z.number().optional(),
    description: zod_1.z.string().optional(),
});
exports.SkillSchema = zod_1.z.object({
    id: zod_1.z.number().optional(),
    name: zod_1.z.string().min(1, 'Skill name is required'),
});
exports.LanguageSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Language name is required'),
    proficiency: zod_1.z.string().min(1, 'Proficiency is required'),
});
exports.CertificationSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Certification name is required'),
    issuer: zod_1.z.string().min(1, 'Issuer is required'),
    issueDate: zod_1.z.string().optional(),
});
// Contact info schema - used in multiple places
exports.ContactInfoSchema = zod_1.z.object({
    fullName: zod_1.z.string().optional(),
    email: zod_1.z.string().email('Invalid email').optional(),
    phone: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
});
// Date parsing utility schema
exports.DateTimeSchema = zod_1.z.string().datetime().optional();
