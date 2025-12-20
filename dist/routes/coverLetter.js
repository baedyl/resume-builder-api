"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const asyncHandler_1 = require("../utils/asyncHandler");
const pdfkit_1 = __importDefault(require("pdfkit"));
const subscription_1 = require("../middleware/subscription");
// Import shared utilities and services
const database_1 = require("../lib/database");
const language_1 = require("../utils/language");
const openai_1 = require("../utils/openai");
const validation_1 = require("../utils/validation");
const errorHandling_1 = require("../utils/errorHandling");
const router = express_1.default.Router();
function sendPdfDocument(res, doc, filename) {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', pdfBuffer.length.toString());
        }
        res.end(pdfBuffer);
    });
    doc.on('error', () => {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to generate PDF' });
        }
        else {
            try {
                res.end();
            }
            catch (_) { /* noop */ }
        }
    });
    doc.end();
}
// Validation schemas using shared components
const CoverLetterGenerateSchema = zod_1.z.object({
    jobDescription: zod_1.z.string().min(1, 'Job description is required'),
}).merge(validation_1.ContactInfoSchema);
const CoverLetterSchema = zod_1.z.object({
    content: zod_1.z.string().min(1, 'Content is required'),
}).merge(validation_1.ContactInfoSchema);
// POST /api/cover-letter - Generate and save a new cover letter
router.post('/', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    try {
        const parsed = CoverLetterGenerateSchema.parse(req.body);
        const { jobDescription, fullName, email, phone, address } = parsed;
        // Detect language and generate cover letter
        const languageInfo = await (0, language_1.detectLanguage)(jobDescription);
        // Set system message based on language
        let systemMessage = 'You are a helpful assistant.';
        if (languageInfo.code === 'fr')
            systemMessage = 'Vous êtes un assistant utile.';
        else if (languageInfo.code === 'es')
            systemMessage = 'Eres un asistente útil.';
        const prompt = `Write a professional cover letter for the following job description. Use the provided personal information if available. ${languageInfo.instruction}

Job Description:
${jobDescription}

Personal Information:
- Name: ${fullName || 'Not provided'}
- Email: ${email || 'Not provided'}
- Phone: ${phone || 'Not provided'}
- Address: ${address || 'Not provided'}

Please write a compelling, professional cover letter that highlights relevant skills and experience.`;
        // Create language-appropriate fallback content
        const fallbackContent = languageInfo.code === 'es'
            ? 'Estimado Gerente de Contratación,\n\nLe escribo para expresar mi interés en la posición descrita. Con mi formación y experiencia, creo que sería una valiosa adición a su equipo.\n\nGracias por su consideración.\n\nAtentamente,\n[Su Nombre]'
            : languageInfo.code === 'fr'
                ? 'Cher Responsable du Recrutement,\n\nJe vous écris pour exprimer mon intérêt pour le poste décrit. Avec ma formation et mon expérience, je pense que je serais un ajout précieux à votre équipe.\n\nMerci pour votre considération.\n\nCordialement,\n[Votre Nom]'
                : 'Dear Hiring Manager,\n\nI am writing to express my interest in the position described. With my background and experience, I believe I would be a valuable addition to your team.\n\nThank you for your consideration.\n\nSincerely,\n[Your Name]';
        const content = await (0, openai_1.enhanceWithOpenAI)(prompt, systemMessage, fallbackContent);
        // Save cover letter to database
        const coverLetter = await database_1.prisma.coverLetter.create({
            data: {
                userId,
                content,
                fullName,
                email,
                phone,
                address,
            },
        });
        res.status(201).json(coverLetter);
    }
    catch (error) {
        (0, errorHandling_1.handleValidationError)(error, res);
    }
}));
// GET /api/cover-letter - List all cover letters for the authenticated user
router.get('/', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    try {
        const coverLetters = await database_1.prisma.coverLetter.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
        });
        res.json(coverLetters);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch cover letters');
    }
}));
// GET /api/cover-letter/:id - Get a specific cover letter
router.get('/:id', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    const coverLetterId = parseInt(req.params.id, 10);
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    if (isNaN(coverLetterId)) {
        return res.status(400).json({ error: 'Invalid cover letter ID' });
    }
    try {
        const coverLetter = await database_1.prisma.coverLetter.findFirst({
            where: { id: coverLetterId, userId },
        });
        if (!coverLetter) {
            (0, errorHandling_1.handleNotFound)(res, 'Cover letter');
            return;
        }
        res.json(coverLetter);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch cover letter');
    }
}));
// PUT /api/cover-letter/:id - Update a specific cover letter
router.put('/:id', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    const coverLetterId = parseInt(req.params.id, 10);
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    if (isNaN(coverLetterId)) {
        return res.status(400).json({ error: 'Invalid cover letter ID' });
    }
    try {
        const parsed = CoverLetterSchema.parse(req.body);
        const { content, fullName, email, phone, address } = parsed;
        // Check if cover letter exists and belongs to user
        const existingCoverLetter = await database_1.prisma.coverLetter.findFirst({
            where: { id: coverLetterId, userId },
        });
        if (!existingCoverLetter) {
            (0, errorHandling_1.handleNotFound)(res, 'Cover letter');
            return;
        }
        const updatedCoverLetter = await database_1.prisma.coverLetter.update({
            where: { id: coverLetterId },
            data: {
                content,
                fullName,
                email,
                phone,
                address,
            },
        });
        res.json(updatedCoverLetter);
    }
    catch (error) {
        (0, errorHandling_1.handleValidationError)(error, res);
    }
}));
// DELETE /api/cover-letter/:id - Delete a specific cover letter
router.delete('/:id', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    const coverLetterId = parseInt(req.params.id, 10);
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    if (isNaN(coverLetterId)) {
        return res.status(400).json({ error: 'Invalid cover letter ID' });
    }
    try {
        // Check if cover letter exists and belongs to user
        const existingCoverLetter = await database_1.prisma.coverLetter.findFirst({
            where: { id: coverLetterId, userId },
        });
        if (!existingCoverLetter) {
            (0, errorHandling_1.handleNotFound)(res, 'Cover letter');
            return;
        }
        await database_1.prisma.coverLetter.delete({
            where: { id: coverLetterId },
        });
        res.status(204).send();
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'delete cover letter');
    }
}));
// POST /api/cover-letter/:id/pdf - Generate PDF for a specific cover letter
router.post('/:id/pdf', auth_1.ensureAuthenticated, subscription_1.requirePremium, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.sub;
    const coverLetterId = parseInt(req.params.id, 10);
    if (!userId) {
        (0, errorHandling_1.handleUnauthorized)(res);
        return;
    }
    if (isNaN(coverLetterId)) {
        return res.status(400).json({ error: 'Invalid cover letter ID' });
    }
    try {
        const coverLetter = await database_1.prisma.coverLetter.findFirst({
            where: { id: coverLetterId, userId },
        });
        if (!coverLetter) {
            (0, errorHandling_1.handleNotFound)(res, 'Cover letter');
            return;
        }
        // Generate PDF
        const doc = new pdfkit_1.default({
            size: 'LETTER',
            margins: {
                top: 50,
                bottom: 50,
                left: 50,
                right: 50
            }
        });
        // Header with personal information
        if (coverLetter.fullName) {
            doc.font('Helvetica-Bold')
                .fontSize(16)
                .text(coverLetter.fullName, { align: 'center' });
            doc.moveDown(0.5);
        }
        const contactInfo = [
            coverLetter.email,
            coverLetter.phone,
            coverLetter.address,
        ].filter(Boolean).join(' • ');
        if (contactInfo) {
            doc.font('Helvetica')
                .fontSize(11)
                .text(contactInfo, { align: 'center' });
            doc.moveDown(1);
        }
        // Current date
        const currentDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        doc.font('Helvetica')
            .fontSize(11)
            .text(currentDate, { align: 'right' });
        doc.moveDown(2);
        // Cover letter content
        doc.font('Helvetica')
            .fontSize(11)
            .text(coverLetter.content, {
            align: 'justify',
            lineGap: 3
        });
        sendPdfDocument(res, doc, 'cover-letter.pdf');
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'generate cover letter PDF');
    }
}));
exports.default = router;
