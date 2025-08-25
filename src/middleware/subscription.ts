import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/database';

interface AuthenticatedRequest extends Request {
    user?: {
        sub: string;
        email?: string;
        isPremium?: boolean;
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
        const isPremium = Boolean(user.planType === 'premium' && 
                         user.subscriptionStatus === 'active' &&
                         user.subscriptionEnd && 
                         new Date(user.subscriptionEnd) > new Date());

        // Add debugging information
        console.log('Subscription middleware check for user:', userId);
        console.log('User subscription data:', {
            planType: user.planType,
            subscriptionStatus: user.subscriptionStatus,
            subscriptionEnd: user.subscriptionEnd,
            isPremium
        });

        if (!isPremium) {
            console.log('User rejected by subscription middleware');
            
            // Check if subscription has expired
            let errorMessage = 'Premium subscription required';
            let details = null;
            
            if (user.subscriptionStatus === 'expired') {
                errorMessage = 'Your premium subscription has expired';
                details = {
                    expiredDate: user.subscriptionEnd,
                    message: 'Please renew your subscription to continue accessing premium features.'
                };
            } else if (user.subscriptionEnd && new Date(user.subscriptionEnd) < new Date()) {
                errorMessage = 'Your premium subscription has expired';
                details = {
                    expiredDate: user.subscriptionEnd,
                    message: 'Your subscription ended on ' + new Date(user.subscriptionEnd).toLocaleDateString() + '. Please renew to continue.'
                };
            }
            
            return res.status(403).json({ 
                error: errorMessage,
                upgradeUrl: '/upgrade',
                details: details,
                debug: {
                    planType: user.planType,
                    subscriptionStatus: user.subscriptionStatus,
                    subscriptionEnd: user.subscriptionEnd,
                    currentTime: new Date().toISOString()
                }
            });
        }

        next();
    } catch (error) {
        console.error('Subscription check error:', error);
        return res.status(500).json({ error: 'Subscription check failed' });
    }
};

// New middleware that allows free users but provides premium features to premium users
export const withPremiumFeatures = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
            // Allow access but mark as free user
            if (req.user) {
                req.user.isPremium = false;
            }
            return next();
        }

        // Check if user has active premium subscription
        const isPremium = Boolean(user.planType === 'premium' && 
                         user.subscriptionStatus === 'active' &&
                         user.subscriptionEnd && 
                         new Date(user.subscriptionEnd) > new Date());

        // Add debugging information
        console.log('withPremiumFeatures middleware check for user:', userId);
        console.log('User subscription data:', {
            planType: user.planType,
            subscriptionStatus: user.subscriptionStatus,
            subscriptionEnd: user.subscriptionEnd,
            isPremium
        });

        // Add premium status to request object
        if (req.user) {
            req.user.isPremium = isPremium;
        }

        next();
    } catch (error) {
        console.error('Subscription check error:', error);
        // Allow access even if subscription check fails
        if (req.user) {
            req.user.isPremium = false;
        }
        return next();
    }
};

// Middleware to check if user is premium (for conditional features)
export const checkPremiumStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            if (req.user) {
                req.user.isPremium = false;
            }
            return next();
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                planType: true, 
                subscriptionStatus: true,
                subscriptionEnd: true 
            }
        });

        if (!user) {
            if (req.user) {
                req.user.isPremium = false;
            }
            return next();
        }

        const isPremium = Boolean(user.planType === 'premium' && 
                         user.subscriptionStatus === 'active' &&
                         user.subscriptionEnd && 
                         new Date(user.subscriptionEnd) > new Date());

        if (req.user) {
            req.user.isPremium = isPremium;
        }
        next();
    } catch (error) {
        console.error('Premium status check error:', error);
        if (req.user) {
            req.user.isPremium = false;
        }
        next();
    }
};
