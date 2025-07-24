// Load environment variables first
import dotenv from 'dotenv';
dotenv.config();

const express = require('express');
import cors from 'cors';
import resumeRouter from './routes/resume';
import skillRouter from './routes/skill';
import coverLetterRouter from './routes/coverLetter';
import jobRouter from './routes/job';
import stripeRouter from './routes/stripe';
import { ensureAuthenticated } from './middleware/auth'; // Adjust path as needed

const app = express();

// Configure CORS for your frontend origins
app.use(cors({
    origin: ['http://localhost:5173', 'https://www.proairesume.online', 'https://resume-builder-front.vercel.app'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// IMPORTANT: Stripe webhook must come BEFORE express.json() to handle raw body
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeRouter);

// Now add JSON parsing for other routes
app.use(express.json());

// Protect API routes with authentication middleware
app.use('/api/resumes', ensureAuthenticated, resumeRouter);
app.use('/api/skills', skillRouter);
app.use('/api/cover-letter', coverLetterRouter);
app.use('/api/jobs', jobRouter);
app.use('/api/stripe', stripeRouter);

app.listen(3000, () => console.log('Server running on port 3000'));