import express from 'express';
import { z } from 'zod';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { withPremiumFeatures } from '../middleware/subscription';
import { 
    handleValidationError, 
    handleDatabaseError, 
    handleUnauthorized, 
    handleNotFound 
} from '../utils/errorHandling';
import { analyzeLinkedInProfile } from '../services/linkedinService';
import { rateLimitMiddleware } from '../middleware/rateLimit';

const router = express.Router();

// Validation schema for LinkedIn analysis request
const LinkedInAnalysisSchema = z.object({
    profileUrl: z.string()
        .url('Invalid URL format')
        .refine((url) => url.includes('linkedin.com/in/'), {
            message: 'URL must be a LinkedIn profile URL (linkedin.com/in/...)'
        }),
    analysisType: z.enum(['basic', 'detailed', 'comprehensive']).optional().default('basic')
});

// Cache for storing analysis results (in production, use Redis)
const analysisCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// POST /api/linkedin/analyze
router.post('/analyze', 
    ensureAuthenticated,
    withPremiumFeatures,
    rateLimitMiddleware('linkedin-analysis', 10, 60), // 10 requests per minute
    asyncHandler(async (req: any, res) => {
        try {
            // Validate request body
            const validationResult = LinkedInAnalysisSchema.safeParse(req.body);
            if (!validationResult.success) {
                return handleValidationError(validationResult.error, res);
            }

            const { profileUrl, analysisType } = validationResult.data;
            const userId = req.user?.sub;
            const isPremium = req.user?.isPremium || false;

            // Check if user is premium for detailed/comprehensive analysis
            if ((analysisType === 'detailed' || analysisType === 'comprehensive') && !isPremium) {
                return res.status(403).json({
                    error: 'Premium subscription required for detailed analysis',
                    upgradeUrl: '/upgrade',
                    availableTypes: ['basic']
                });
            }

            // Check cache first
            const cacheKey = `${userId}:${profileUrl}:${analysisType}`;
            const cached = analysisCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
                return res.json({
                    ...cached.data,
                    cached: true,
                    cacheExpiry: new Date(cached.timestamp + CACHE_DURATION).toISOString()
                });
            }

            // Perform LinkedIn analysis
            const analysisResult = await analyzeLinkedInProfile(profileUrl, analysisType, isPremium);

            // Cache the result
            analysisCache.set(cacheKey, {
                data: analysisResult,
                timestamp: Date.now()
            });

            // Clean up old cache entries (simple cleanup)
            if (analysisCache.size > 1000) {
                const now = Date.now();
                for (const [key, value] of analysisCache.entries()) {
                    if (now - value.timestamp > CACHE_DURATION) {
                        analysisCache.delete(key);
                    }
                }
            }

            res.json(analysisResult);

        } catch (error: any) {
            console.error('LinkedIn analysis error:', error);
            
            if (error.message?.includes('rate limit')) {
                return res.status(429).json({
                    error: 'Rate limit exceeded. Please try again later.',
                    retryAfter: 60
                });
            }
            
            if (error.message?.includes('profile not found')) {
                return res.status(404).json({
                    error: 'LinkedIn profile not found or not accessible',
                    suggestions: [
                        'Verify the profile URL is correct',
                        'Ensure the profile is public',
                        'Check if the profile exists'
                    ]
                });
            }

            return res.status(500).json({
                error: 'Failed to analyze LinkedIn profile',
                message: error.message || 'Unknown error occurred'
            });
        }
    })
);

// GET /api/linkedin/analysis/:id - Get cached analysis
router.get('/analysis/:id', 
    ensureAuthenticated,
    asyncHandler(async (req: any, res) => {
        const { id } = req.params;
        const userId = req.user?.sub;

        // Find cached analysis by ID (in production, store in database)
        const cacheKey = `${userId}:${id}`;
        const cached = analysisCache.get(cacheKey);
        
        if (!cached) {
            return handleNotFound(res, 'Analysis not found');
        }

        res.json({
            ...cached.data,
            cached: true,
            cacheExpiry: new Date(cached.timestamp + CACHE_DURATION).toISOString()
        });
    })
);

// DELETE /api/linkedin/analysis/:id - Clear cached analysis
router.delete('/analysis/:id', 
    ensureAuthenticated,
    asyncHandler(async (req: any, res) => {
        const { id } = req.params;
        const userId = req.user?.sub;

        const cacheKey = `${userId}:${id}`;
        const deleted = analysisCache.delete(cacheKey);
        
        if (!deleted) {
            return handleNotFound(res, 'Analysis not found');
        }

        res.json({ message: 'Analysis cache cleared successfully' });
    })
);

// GET /api/linkedin/analyses - List user's cached analyses
router.get('/analyses', 
    ensureAuthenticated,
    asyncHandler(async (req: any, res) => {
        const userId = req.user?.sub;
        
        // Get all cached analyses for this user
        const userAnalyses = Array.from(analysisCache.entries())
            .filter(([key]) => key.startsWith(`${userId}:`))
            .map(([key, value]) => ({
                id: key.split(':').slice(1).join(':'),
                timestamp: value.timestamp,
                cacheExpiry: new Date(value.timestamp + CACHE_DURATION).toISOString(),
                analysisType: value.data.analysisType || 'basic'
            }))
            .sort((a, b) => b.timestamp - a.timestamp);

        res.json({
            analyses: userAnalyses,
            total: userAnalyses.length
        });
    })
);

export default router;
