// src/index.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import resumeRouter from './routes/resume';
import skillRouter from './routes/skill';

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'https://resume-builder-front.vercel.app'] }));
app.use(express.json());

app.use('/api/resumes', resumeRouter);
app.use('/api/skills', skillRouter);

app.listen(3000, () => console.log('Server running on port 3000'));