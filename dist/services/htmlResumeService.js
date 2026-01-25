"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateHTMLResume = generateHTMLResume;
const fs_1 = require("fs");
const path_1 = require("path");
const mustache_1 = __importDefault(require("mustache"));
const language_1 = require("../utils/language");
function getTemplate(templateName) {
    const templatePath = (0, path_1.join)(__dirname, '..', 'templates', 'html', `${templateName}.html`);
    return (0, fs_1.readFileSync)(templatePath, 'utf-8');
}
function processLanguageProficiency(language) {
    const proficiencyLevels = {
        'Beginner': 1,
        'Elementary': 2,
        'Intermediate': 3,
        'Advanced': 4,
        'Native': 5,
        'Fluent': 4
    };
    const level = proficiencyLevels[language.proficiency] || 3;
    const circles = [];
    for (let i = 0; i < 5; i++) {
        circles.push({
            filled: i < level
        });
    }
    return {
        ...language,
        proficiencyLevels: circles
    };
}
function formatDate(date) {
    if (!date)
        return '';
    // Handle "Present" case for current jobs
    if (typeof date === 'string' && date.toLowerCase() === 'present') {
        return 'Present';
    }
    const d = new Date(date);
    // Check if the date is valid
    if (isNaN(d.getTime())) {
        return 'Present'; // Fallback for invalid dates
    }
    // Use UTC to avoid timezone shifting dates into previous year
    return d.getUTCFullYear().toString();
}
function generateHTMLResume(data, templateName = 'colorful', language = 'en') {
    const template = getTemplate(templateName);
    const languageConfig = (0, language_1.getLanguageConfig)(language);
    // Process data for template
    const processedData = {
        ...data,
        titles: languageConfig.sections,
        labels: languageConfig.labels || { tech: 'Tech' },
        showCertifications: Array.isArray(data.certifications) && data.certifications.length > 0,
        headline: data.title || data.profession || data.role || (data.workExperience && data.workExperience[0] && data.workExperience[0].jobTitle) || undefined,
        languagesLine: (data.languages || [])
            .map(l => `${l.name}: ${l.proficiency}`)
            .join(', '),
        skillsLine: (data.skills || [])
            .map(s => s.name)
            .join(', '),
        workExperience: data.workExperience.map(exp => ({
            ...exp,
            startDate: formatDate(exp.startDate),
            endDate: exp.endDate && exp.endDate !== 'Present' ? formatDate(exp.endDate) : 'Present',
            tasks: (() => {
                const companyDesc = String(exp.companyDescription || '').trim();
                const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const base = String(exp.description || '');
                const raw = companyDesc
                    ? base.replace(new RegExp(escapeRegex(companyDesc), 'ig'), '').trim()
                    : base;
                const parts = raw.includes('•') ? raw.split('•') : raw.split('.');
                const cleaned = parts
                    .map(part => part.replace(/^\s*[•\-]\s*/g, '').trim())
                    .filter(Boolean);
                // Remove duplicates and any task that equals the company description
                const seen = new Set();
                const companyDescNorm = companyDesc.toLowerCase();
                return cleaned.filter(item => {
                    const normalized = item.replace(/[\.;\s]+$/g, '').toLowerCase();
                    if (companyDescNorm && normalized === companyDescNorm)
                        return false;
                    if (seen.has(normalized))
                        return false;
                    seen.add(normalized);
                    return true;
                });
            })()
        })),
        education: data.education.map(edu => {
            var _a;
            return ({
                ...edu,
                startYear: edu.startYear,
                graduationYear: (_a = edu.graduationYear) === null || _a === void 0 ? void 0 : _a.toString()
            });
        }),
        languages: data.languages.map(l => {
            const name = (0, language_1.localizeLanguageName)(l.name, language);
            const proficiency = (0, language_1.localizeProficiency)(l.proficiency, language);
            const processed = processLanguageProficiency({ name, proficiency });
            return {
                name,
                proficiency,
                proficiencyLevels: processed.proficiencyLevels
            };
        }),
        certifications: (data.certifications || []).map(cert => ({
            ...cert,
            issueDate: cert.issueDate ? formatDate(cert.issueDate) : undefined
        }))
    };
    return mustache_1.default.render(template, processedData);
}
