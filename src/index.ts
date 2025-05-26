import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import resumeRouter from './routes/resume'; // Assuming you'll rename routes/index.ts to resume.ts
import skillRouter from './routes/skill';
import authRouter from './routes/auth';

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000', 'https://resume-builder-front.vercel.app'] }));
app.use(express.json());
app.use(session({ secret: 'your-secret-key', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', authRouter);
app.use('/api/resumes', resumeRouter);
app.use('/api/skills', skillRouter);

app.listen(3000, () => console.log('Server running on port 3000'));