import { Router } from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// Configure Passport local strategy
passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email: string, password: string, done) => {
        try {
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return done(null, false, { message: 'No user found' });
            }
            const isMatch = await bcrypt.compare(password, user.password || '');
            if (isMatch) {
                return done(null, user);
            } else {
                return done(null, false, { message: 'Incorrect password' });
            }
        } catch (err) {
            return done(err);
        }
    })
);

// Serialize and deserialize user for session management
passport.serializeUser((user: any, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Registration route
router.post('/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.create({
            data: { email, password: hashedPassword },
        });
        res.status(201).json({ message: 'User registered' });
    } catch (err) {
        res.status(500).json({ error: 'Error registering user' });
    }
});

// Login route
router.post('/login', passport.authenticate('local'), (req, res) => {
    res.json({ message: 'Logged in', user: req.user });
});

// Logout route
router.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            res.status(500).json({ error: 'Error logging out' });
        } else {
            res.json({ message: 'Logged out' });
        }
    });
});

export default router;