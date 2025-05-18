import PDFDocument from 'pdfkit';
import { Request, Response, Router } from 'express';

interface WorkExperience {
  company: string;
  position: string;
  startDate: string;
  endDate?: string;
  description: string;
}

interface Education {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  graduationYear: string;
}

interface Skill { id: number; name: string }

interface Resume {
  fullName: string;
  email: string;
  phone?: string;
  summary?: string;
  skills: Skill[];
  workExperience: WorkExperience[];
  education: Education[];
}

const router = Router();

router.post('/', async (req: Request<{}, {}, Resume>, res: Response) => {
  try {
    const resume = req.body;
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

    // Page dimensions (8.5x11" at 72pt/inch, minus margins)
    const pageHeight = doc.page.height - 100; // 792pt - 50pt top/bottom margins

    // Function to check if we need a new page
    const ensureSpace = (requiredHeight: number) => {
      if (currentY + requiredHeight > pageHeight) {
        doc.addPage();
        currentY = 50; // Reset to top of new page
      }
    };

    doc.font('Helvetica-Bold').fontSize(14).text(`Name: ${resume.fullName}`, 50, 50);
    doc.font('Helvetica').fontSize(12).text(`Email: ${resume.email}`, 50, 70);

    let currentY = 90;

    if (resume.phone) {
      ensureSpace(16);
      doc.text(`Phone: ${resume.phone}`, 50, currentY);
      currentY += 16;
    }
    currentY += 12; // Uniform gap after personal info

    if (resume.summary) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').text('Summary:', 50, currentY);
      currentY += 14;
      doc.font('Helvetica').fontSize(12);
      const summaryHeight = doc.heightOfString(resume.summary, { width: 500, lineGap: 0 });
      ensureSpace(summaryHeight);
      doc.text(resume.summary, 50, currentY, { width: 500, lineGap: 0 });
      currentY += summaryHeight + 5;
      currentY += 12; // Uniform gap after section
    }

    if (resume.workExperience.length > 0) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').text('Work Experience:', 50, currentY);
      currentY += 14;
      currentY += 6; // 20pt gap before first experience
      resume.workExperience.forEach((exp) => {
        ensureSpace(48);
        // Position and company on the same line
        doc.font('Helvetica-Bold').text(`${exp.position} | `, 50, currentY, { continued: true });
        doc.font('Helvetica').text(`${exp.company}`, { continued: true });
        // Right-aligned dates in bold
        doc.font('Helvetica-Bold').text(`${exp.startDate} – ${exp.endDate || 'Present'}`, { align: 'right' });
        currentY += 18; // 18pt gap before description
        // Split description into bullet points
        const bullets = exp.description
          .split('.')
          .map((b) => b.trim())
          .filter((b) => b.length > 0)
          .map((b) => (b.endsWith('.') ? b : `${b}.`)); // Ensure each bullet ends with a period
        bullets.forEach((bullet) => {
          const bulletHeight = doc.heightOfString(`- ${bullet}`, { width: 490, lineGap: 0 });
          ensureSpace(bulletHeight + 8);
          doc.font('Helvetica').text(`- ${bullet}`, 60, currentY, { width: 490, lineGap: 0 });
          currentY += bulletHeight + 8; // 8pt between bullets
        });
        currentY += 12; // Extra gap after bullets
      });
      currentY += 12; // Uniform gap after section
    }

    if (resume.skills.length > 0) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').text('Skills:', 50, currentY);
      currentY += 14;
      resume.skills.forEach((skill) => {
        ensureSpace(16);
        doc.font('Helvetica').text(`- ${skill.name}`, 60, currentY);
        currentY += 12;
      });
      currentY += 12; // Uniform gap after section
    }

    if (resume.education.length > 0) {
      ensureSpace(36);
      doc.font('Helvetica-Bold').text('Education:', 50, currentY);
      currentY += 14;
      currentY += 6; // 20pt gap before first entry
      resume.education.forEach((edu) => {
        ensureSpace(16);
        // Degree, institution, and year on the same line
        doc.font('Helvetica-Bold').text(`${edu.degree} – `, 50, currentY, { continued: true });
        doc.font('Helvetica').text(`${edu.institution} | `, { continued: true });
        doc.font('Helvetica-Bold').text(`${edu.graduationYear}`);
        currentY += 12; // Spacing after entry
      });
      currentY += 12; // Uniform gap after section
    }

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

export default router;