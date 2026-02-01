"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Load environment variables first
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Polyfill ReadableStream for Puppeteer in environments where it might be missing
const web_1 = require("stream/web");
if (!global.ReadableStream) {
    global.ReadableStream = web_1.ReadableStream;
}
// Polyfill fetch for Node 16
if (!global.fetch) {
    const nodeFetch = require('node-fetch');
    global.fetch = nodeFetch;
    global.Headers = nodeFetch.Headers;
    global.Request = nodeFetch.Request;
    global.Response = nodeFetch.Response;
}
const express = require('express');
const cors_1 = __importDefault(require("cors"));
const resume_1 = __importDefault(require("./routes/resume"));
const skill_1 = __importDefault(require("./routes/skill"));
const coverLetter_1 = __importDefault(require("./routes/coverLetter"));
const job_1 = __importDefault(require("./routes/job"));
const jobOpportunity_1 = __importDefault(require("./routes/jobOpportunity"));
const stripe_1 = __importDefault(require("./routes/stripe"));
const auth_1 = __importDefault(require("./routes/auth"));
const auth_2 = require("./middleware/auth"); // Adjust path as needed
const jobScheduler_1 = require("./services/jobScheduler");
const app = express();
// Configure CORS for your frontend origins
app.use((0, cors_1.default)({
    origin: ['http://localhost:5173', 'https://www.proairesume.online', 'https://resume-builder-front.vercel.app'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
// IMPORTANT: Stripe webhook must come BEFORE express.json() to handle raw body
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        const stripe = require('./lib/stripe').stripe;
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        console.log(`Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    // Import and handle the webhook event
    const { handleWebhookEvent } = require('./routes/stripe');
    handleWebhookEvent(event).then(() => {
        res.json({ received: true });
    }).catch((error) => {
        console.error('Webhook handling error:', error);
        res.status(500).json({ error: 'Webhook handling failed' });
    });
});
// Now add JSON parsing for other routes
app.use(express.json());
// Protect API routes with authentication middleware
app.use('/api/resumes', auth_2.ensureAuthenticated, resume_1.default);
app.use('/api/skills', skill_1.default);
app.use('/api/cover-letter', coverLetter_1.default);
app.use('/api/jobs', job_1.default);
app.use('/api/job-opportunities', jobOpportunity_1.default);
app.use('/api/stripe', stripe_1.default);
app.use('/api/auth', auth_1.default);
// Start job scheduler
jobScheduler_1.JobScheduler.start();
const server = app.listen(3000, () => console.log('Server running on port 3000'));
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    jobScheduler_1.JobScheduler.stop();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    jobScheduler_1.JobScheduler.stop();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
