import PDFDocument from 'pdfkit';
import { Request, Response, Router } from 'express';

interface Skill { id: number; name: string }
interface Resume { fullName: string; email: string; phone?: string; summary?: string; skills: Skill[] }

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

        doc.font('Helvetica-Bold').fontSize(14).text(`Name: ${resume.fullName}`, 50, 50);
        doc.font('Helvetica').fontSize(12).text(`Email: ${resume.email}`, 50, 70);

        let currentY = 90; // Track Y position dynamically

        // Conditionally add Phone
        if (resume.phone) {
            doc.text(`Phone: ${resume.phone}`, 50, currentY);
            currentY += 20;
        }

        // Conditionally add Summary
        if (resume.summary) {
            doc.font('Helvetica-Bold').text('Summary:', 50, currentY);
            currentY += 20;
            doc.font('Helvetica').fontSize(12); // Ensure font size is set before height calculation
            const summaryHeight = doc.heightOfString(resume.summary, { width: 500, lineGap: 2 });
            doc.text(resume.summary, 50, currentY, { width: 500, lineGap: 2 });
            currentY += summaryHeight + 10; // Reduced padding to 10px
        }

        // Skills section
        doc.font('Helvetica-Bold').text('Skills:', 50, currentY);
        currentY += 20;
        resume.skills.forEach((skill) => {
            doc.font('Helvetica').text(`- ${skill.name}`, 60, currentY);
            currentY += 20;
        });

        doc.end();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

export default router;