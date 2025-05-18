import PDFDocument from 'pdfkit';
import { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const router = Router();

// Zod schemas
const WorkExperienceSchema = z.object({
  jobTitle: z.string().min(1, 'Job title is required'),
  company: z.string().min(1, 'Company is required'),
  location: z.string().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  description: z.string().optional(),
});

const EducationSchema = z.object({
  degree: z.string().min(1, 'Degree is required'),
  major: z.string().optional(),
  institution: z.string().min(1, 'Institution is required'),
  graduationYear: z.number().int().min(1900, 'Graduation year must be a valid year').max(9999, 'Graduation year must be a valid year').optional(),
  gpa: z.number().optional(),
  description: z.string().optional(),
});

const SkillSchema = z.object({
  id: z.number(),
  name: z.string().min(1, 'Skill name is required'),
});

const LanguageSchema = z.object({
  name: z.string().min(1, 'Language name is required'),
  proficiency: z.string().min(1, 'Proficiency is required'),
});

const CertificationSchema = z.object({
  name: z.string().min(1, 'Certification name is required'),
  issuer: z.string().min(1, 'Issuer is required'),
  issueDate: z.string().optional(),
});

const ResumeSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  address: z.string().optional(),
  linkedIn: z.string().optional(),
  website: z.string().optional(),
  summary: z.string().optional(),
  skills: z.array(SkillSchema).default([]),
  workExperience: z.array(WorkExperienceSchema).min(1, 'At least one work experience is required'),
  education: z.array(EducationSchema).min(1, 'At least one education entry is required'),
  languages: z.array(LanguageSchema).default([]),
  certifications: z.array(CertificationSchema).default([]),
});

type Skill = z.infer<typeof SkillSchema>;
type Language = z.infer<typeof LanguageSchema>;

// POST /api/resumes
router.post('/', async (req: Request, res: Response) => {
  try {
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    const resume = ResumeSchema.parse(req.body);
    console.log('Parsed resume:', JSON.stringify(resume, null, 2));

    // Handle custom skills (negative IDs)
    const processedSkills: Skill[] = [];
    for (const skill of resume.skills) {
      try {
        const newSkill = await prisma.skill.upsert({
          where: { name: skill.name },
          update: {},
          create: { name: skill.name },
        });
        processedSkills.push(newSkill);
      } catch (error) {
        console.error(`Failed to upsert skill: ${skill.name}`, error);
        throw new Error('Failed to process skills');
      }
    }
    resume.skills = processedSkills;

    // Handle languages
    const processedLanguages: Language[] = [];
    for (const lang of resume.languages) {
      try {
        const newLang = await prisma.language.upsert({
          where: { name_proficiency: { name: lang.name, proficiency: lang.proficiency } },
          update: {},
          create: { name: lang.name, proficiency: lang.proficiency },
        });
        processedLanguages.push({ name: newLang.name, proficiency: newLang.proficiency });
      } catch (error) {
        console.error(`Failed to upsert language: ${lang.name}, ${lang.proficiency}`, error);
        throw new Error('Failed to process languages');
      }
    }
    resume.languages = processedLanguages;

    const doc = new PDFDocument({ margin: 50 });
    let buffers: Buffer[] = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=resume.pdf',
      });
      res.send(pdfData);
    });

    const pageWidth = doc.page.width - 100; // Account for margins
    const pageHeight = doc.page.height - 100;
    let currentY = 50;

    const ensureSpace = (requiredHeight: number) => {
      if (currentY + requiredHeight > pageHeight) {
        doc.addPage();
        currentY = 50;
      }
    };

    // Centered User Info Header
    doc.font('Helvetica-Bold').fontSize(18).text(resume.fullName, 50, currentY, { align: 'center' });
    currentY += 24;
    if (resume.website) {
      ensureSpace(16);
      doc.font('Helvetica').fontSize(12).text(resume.website, 50, currentY, { align: 'center' });
      currentY += 16;
    }
    const contactParts = [];
    if (resume.address) contactParts.push(resume.address);
    if (resume.phone) contactParts.push(resume.phone);
    if (resume.email) contactParts.push(resume.email);
    if (contactParts.length > 0) {
      ensureSpace(16);
      doc.font('Helvetica').fontSize(12).text(contactParts.join(' | '), 50, currentY, { align: 'center' });
      currentY += 16;
    }
    // Add horizontal line
    ensureSpace(20);
    doc.moveTo(50, currentY).lineTo(pageWidth + 50, currentY).stroke();
    currentY += 20;

    if (resume.summary) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').fontSize(12).text('Summary', 50, currentY);
      currentY += 14;
      doc.font('Helvetica').fontSize(10);
      const summaryHeight = doc.heightOfString(resume.summary, { width: pageWidth });
      ensureSpace(summaryHeight);
      doc.text(resume.summary, 50, currentY, { width: pageWidth });
      currentY += summaryHeight + 16;
    }

    if (resume.workExperience.length > 0) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').fontSize(12).text('Work Experience', 50, currentY);
      currentY += 14;
      resume.workExperience.forEach((exp) => {
        ensureSpace(48);
        doc.font('Helvetica-Bold').fontSize(10).text(`${exp.jobTitle} | `, 50, currentY, { continued: true });
        doc.font('Helvetica').text(`${exp.company}${exp.location ? `, ${exp.location}` : ''}`, { continued: true });
        doc.font('Helvetica-Bold').text(
          ` ${new Date(exp.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} – ${
            exp.endDate ? new Date(exp.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : 'Present'
          }`,
          { align: 'right' }
        );
        currentY += 18;
        if (exp.description) {
          const bullets = exp.description
            .split('.')
            .map((b) => b.trim())
            .filter((b) => b.length > 0)
            .map((b) => (b.endsWith('.') ? b : `${b}.`));
          bullets.forEach((bullet) => {
            const bulletHeight = doc.heightOfString(`  • ${bullet}`, { width: pageWidth - 20 });
            ensureSpace(bulletHeight + 8);
            doc.font('Helvetica').fontSize(10).text(`  • ${bullet}`, 60, currentY, { width: pageWidth - 20 });
            currentY += bulletHeight + 8;
          });
        }
        currentY += 12;
      });
      currentY += 16;
    }

    if (resume.skills.length > 0) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').fontSize(12).text('Skills', 50, currentY);
      currentY += 14;
      resume.skills.forEach((skill) => {
        ensureSpace(16);
        doc.font('Helvetica').fontSize(10).text(`• ${skill.name}`, 60, currentY);
        currentY += 16;
      });
      currentY += 16;
    }

    if (resume.languages.length > 0) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').fontSize(12).text('Languages', 50, currentY);
      currentY += 14;
      resume.languages.forEach((lang) => {
        ensureSpace(16);
        doc.font('Helvetica-Bold').fontSize(10).text(`${lang.name} – `, 60, currentY, { continued: true });
        doc.font('Helvetica').text(lang.proficiency);
        currentY += 16;
      });
      currentY += 16;
    }

    if (resume.certifications.length > 0) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').fontSize(12).text('Certifications', 50, currentY);
      currentY += 14;
      resume.certifications.forEach((cert) => {
        ensureSpace(16);
        doc.font('Helvetica').fontSize(10).text(`${cert.name} – ${cert.issuer}${cert.issueDate ? ` | ${new Date(cert.issueDate).getFullYear()}` : ''}`, 50, currentY);
        currentY += 16;
      });
      currentY += 16;
    }

    if (resume.education.length > 0) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').fontSize(12).text('Education', 50, currentY);
      currentY += 14;
      resume.education.forEach((edu) => {
        ensureSpace(16);
        doc.font('Helvetica-Bold').fontSize(10).text(`${edu.degree}${edu.major ? `, ${edu.major}` : ''} – `, 50, currentY, { continued: true });
        doc.font('Helvetica').text(`${edu.institution}${edu.graduationYear ? ` | ` : ''}`, { continued: true });
        if (edu.graduationYear) {
          doc.font('Helvetica-Bold').text(`${edu.graduationYear}`);
        }
        if (edu.gpa) {
          currentY += 16;
          ensureSpace(16);
          doc.font('Helvetica').fontSize(10).text(`GPA: ${edu.gpa.toFixed(2)}`, 50, currentY);
        }
        if (edu.description) {
          currentY += 16;
          ensureSpace(16);
          doc.font('Helvetica').fontSize(10).text(edu.description, 50, currentY, { width: pageWidth });
          currentY += doc.heightOfString(edu.description, { width: pageWidth }) + 8;
        } else {
          currentY += 16;
        }
      });
      currentY += 16;
    }

    doc.end();
    return;
  } catch (error) {
    console.error('Error in resume endpoint:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    return res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

export default router;