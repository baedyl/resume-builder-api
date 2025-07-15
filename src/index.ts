const express = require('express');
import cors from 'cors';
import resumeRouter from './routes/resume';
import skillRouter from './routes/skill';
import coverLetterRouter from './routes/coverLetter';
import { ensureAuthenticated } from './middleware/auth'; // Adjust path as needed

const app = express();

// Configure CORS for your frontend origins
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'https://resume-builder-front.vercel.app'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Protect API routes with authentication middleware
app.use('/api/resumes', ensureAuthenticated, resumeRouter);
app.use('/api/skills', skillRouter);
app.use('/api/cover-letter', coverLetterRouter);

app.listen(3000, () => console.log('Server running on port 3000'));