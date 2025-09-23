import { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
    windowMs: number; // Time window in milliseconds
    maxRequests: number; // Maximum requests per window
    keyGenerator?: (req: Request) => string; // Custom key generator
    skipSuccessfulRequests?: boolean; // Don't count successful requests
    skipFailedRequests?: boolean; // Don't count failed requests
}

interface RateLimitStore {
    [key: string]: {
        count: number;
        resetTime: number;
    };
}

// In-memory store for rate limiting (use Redis in production)
const store: RateLimitStore = {};

// Clean up expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    Object.keys(store).forEach(key => {
        if (store[key].resetTime < now) {
            delete store[key];
        }
    });
}, 5 * 60 * 1000);

export function rateLimitMiddleware(
    name: string,
    maxRequests: number,
    windowMs: number,
    options: Partial<RateLimitConfig> = {}
): (req: Request, res: Response, next: NextFunction) => void {
    const config: RateLimitConfig = {
        windowMs,
        maxRequests,
        keyGenerator: (req: Request) => {
            // Default key generator uses user ID if available, otherwise IP
            const user = (req as any).user;
            if (user?.sub) {
                return `${name}:${user.sub}`;
            }
            return `${name}:${req.ip}`;
        },
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        ...options
    };

    return (req: Request, res: Response, next: NextFunction) => {
        const key = config.keyGenerator!(req);
        const now = Date.now();
        const windowStart = now - config.windowMs;

        // Get or create rate limit entry
        if (!store[key] || store[key].resetTime < now) {
            store[key] = {
                count: 0,
                resetTime: now + config.windowMs
            };
        }

        const entry = store[key];
        
        // Check if we've exceeded the limit
        if (entry.count >= config.maxRequests) {
            const resetTime = new Date(entry.resetTime);
            const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
            
            return res.status(429).json({
                error: 'Rate limit exceeded',
                message: `Too many requests. Please try again after ${resetTime.toISOString()}`,
                retryAfter,
                limit: config.maxRequests,
                remaining: 0,
                resetTime: resetTime.toISOString()
            });
        }

        // Increment counter
        entry.count++;

        // Add rate limit headers
        res.set({
            'X-RateLimit-Limit': config.maxRequests.toString(),
            'X-RateLimit-Remaining': Math.max(0, config.maxRequests - entry.count).toString(),
            'X-RateLimit-Reset': new Date(entry.resetTime).toISOString()
        });

        // Track response status for conditional counting
        const originalSend = res.send;
        res.send = function(body: any) {
            const statusCode = res.statusCode;
            
            // Only count if not skipping based on status
            if (config.skipSuccessfulRequests && statusCode < 400) {
                entry.count--;
            }
            if (config.skipFailedRequests && statusCode >= 400) {
                entry.count--;
            }

            return originalSend.call(this, body);
        };

        next();
    };
}

// Predefined rate limit configurations
export const rateLimits = {
    // LinkedIn analysis: 10 requests per minute
    linkedinAnalysis: (req: Request, res: Response, next: NextFunction) => 
        rateLimitMiddleware('linkedin-analysis', 10, 60 * 1000)(req, res, next),
    
    // General API: 100 requests per 15 minutes
    general: (req: Request, res: Response, next: NextFunction) => 
        rateLimitMiddleware('general-api', 100, 15 * 60 * 1000)(req, res, next),
    
    // Auth endpoints: 5 requests per minute
    auth: (req: Request, res: Response, next: NextFunction) => 
        rateLimitMiddleware('auth', 5, 60 * 1000)(req, res, next),
    
    // File uploads: 5 requests per minute
    upload: (req: Request, res: Response, next: NextFunction) => 
        rateLimitMiddleware('upload', 5, 60 * 1000)(req, res, next)
};

// Middleware to check if user is approaching rate limit
export function rateLimitWarning(req: Request, res: Response, next: NextFunction) {
    const user = (req as any).user;
    if (!user?.sub) {
        return next();
    }

    const key = `general-api:${user.sub}`;
    const entry = store[key];
    
    if (entry) {
        const remaining = Math.max(0, 100 - entry.count);
        const usagePercentage = (entry.count / 100) * 100;
        
        if (usagePercentage >= 80) {
            res.set('X-RateLimit-Warning', 'Approaching rate limit');
        }
        
        if (remaining <= 10) {
            res.set('X-RateLimit-Warning', 'Rate limit nearly exceeded');
        }
    }
    
    next();
}
