import { Router, Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { Resume } from '../interfaces/resume';

const router = Router();

router.post('/', async (req: Request<{}, {}, Resume>, res: Response) => {
    try {
        const { fullName, email, skills } = req.body;

        const doc = new PDFDocument({ font: 'Helvetica' });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfData = Buffer.concat(buffers);
            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename=resume.pdf',
            });
            res.send(pdfData);
        });

        // Add resume data to PDF
        doc.text(`Name: ${fullName}`, 50, 50);
        doc.text(`Email: ${email}`, 50, 70);
        doc.text('Skills:', 50, 90);
        skills.forEach((skill, index) => {
            doc.text(`- ${skill.name}`, 60, 110 + index * 20);
        });

        doc.end();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

export default router;