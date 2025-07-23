import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/database';

interface AuthenticatedRequest extends Request {
    user?: {
        sub: string;
        email?: string;
    };
}

export const requirePremium = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Check user's subscription status
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                planType: true, 
                subscriptionStatus: true,
                subscriptionEnd: true 
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if user has active premium subscription
        const isPremium = user.planType === 'premium' && 
                         user.subscriptionStatus === 'active' &&
                         user.subscriptionEnd && 
                         new Date(user.subscriptionEnd) > new Date();

        if (!isPremium) {
            return res.status(403).json({ 
                error: 'Premium subscription required',
                upgradeUrl: '/upgrade' 
            });
        }

        next();
    } catch (error) {
        console.error('Subscription check error:', error);
        return res.status(500).json({ error: 'Subscription check failed' });
    }
};
