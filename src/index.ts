// Load environment variables first
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import resumeRouter from './routes/resume';
import skillRouter from './routes/skill';
import coverLetterRouter from './routes/coverLetter';
import jobRouter from './routes/job';
import stripeRouter from './routes/stripe';
import { ensureAuthenticated } from './middleware/auth';

const app = express();

// Configure CORS for your frontend origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
        'http://localhost:5173', 
        'https://www.proairesume.online', 
        'https://resume-builder-front.vercel.app'
      ];

app.use(cors({
    origin: allowedOrigins,
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

// IMPORTANT: Stripe webhook must come BEFORE express.json() to handle raw body
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req: any, res: any) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: any;

    try {
        // Import stripe dynamically to handle CommonJS module
        const { stripe } = require('./lib/stripe');
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

// Health check endpoint for AWS Load Balancer
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Protect API routes with authentication middleware
app.use('/api/resumes', ensureAuthenticated, resumeRouter);
app.use('/api/skills', skillRouter);
app.use('/api/cover-letter', coverLetterRouter);
app.use('/api/jobs', jobRouter);
app.use('/api/stripe', stripeRouter);

app.listen(3000, () => console.log('Server running on port 3000'));