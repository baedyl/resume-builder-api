// Load environment variables first
import dotenv from 'dotenv';
dotenv.config();

// Polyfill fetch for Node 16
if (!global.fetch) {
    const nodeFetch = require('node-fetch');
    (global as any).fetch = nodeFetch;
    (global as any).Headers = nodeFetch.Headers;
    (global as any).Request = nodeFetch.Request;
    (global as any).Response = nodeFetch.Response;
}

const express = require('express');
import cors from 'cors';
import resumeRouter from './routes/resume';
import skillRouter from './routes/skill';
import coverLetterRouter from './routes/coverLetter';
import jobRouter from './routes/job';
import jobOpportunityRouter from './routes/jobOpportunity';
import stripeRouter from './routes/stripe';
import { ensureAuthenticated } from './middleware/auth'; // Adjust path as needed
import { JobScheduler } from './services/jobScheduler';

const app = express();

// Configure CORS for your frontend origins
app.use(cors({
    origin: ['http://localhost:5173', 'https://www.proairesume.online', 'https://resume-builder-front.vercel.app'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// IMPORTANT: Stripe webhook must come BEFORE express.json() to handle raw body
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req: any, res: any) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: any;

    try {
        const stripe = require('./lib/stripe').stripe;
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
        console.log(`Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Import and handle the webhook event
    const { handleWebhookEvent } = require('./routes/stripe');
    handleWebhookEvent(event).then(() => {
        res.json({ received: true });
    }).catch((error: any) => {
        console.error('Webhook handling error:', error);
        res.status(500).json({ error: 'Webhook handling failed' });
    });
});

// Now add JSON parsing for other routes
app.use(express.json());

// Protect API routes with authentication middleware
app.use('/api/resumes', ensureAuthenticated, resumeRouter);
app.use('/api/skills', skillRouter);
app.use('/api/cover-letter', coverLetterRouter);
app.use('/api/jobs', jobRouter);
app.use('/api/job-opportunities', jobOpportunityRouter);
app.use('/api/stripe', stripeRouter);

// Start job scheduler
JobScheduler.start();

const server = app.listen(3000, () => console.log('Server running on port 3000'));

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  JobScheduler.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  JobScheduler.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});