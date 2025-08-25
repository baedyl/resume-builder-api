import express from 'express';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

// Import shared utilities and services
import { prisma } from '../lib/database';
import { stripe } from '../lib/stripe';
import { 
    handleDatabaseError, 
    handleUnauthorized, 
    handleGenericError 
} from '../utils/errorHandling';
import { debugUserSubscription, listUsersWithSubscriptionIssues, checkAndFixExpiredSubscriptions, checkAndFixUserSubscription } from '../utils/subscriptionDebug';

import axios from 'axios'; // Added for Auth0 userinfo test

const router = express.Router();

// Debug endpoint to test JWT token parsing
router.get('/debug-token', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    res.json({
        user: req.user,
        headers: {
            authorization: req.headers.authorization ? 'Bearer [HIDDEN]' : 'None'
        },
        timestamp: new Date().toISOString()
    });
}));

// Test Auth0 userinfo endpoint
router.get('/test-userinfo', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(400).json({ error: 'No token provided' });
    }
    
    try {
        const response = await axios.get(`https://${process.env.AUTH0_DOMAIN}/userinfo`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        res.json({
            userinfo: response.data,
            success: true
        });
    } catch (error: any) {
        console.error('Userinfo error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to fetch userinfo',
            details: error.response?.data || error.message
        });
    }
}));

// Clean up invalid customer IDs (development only)
router.post('/cleanup-customers', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ error: 'This endpoint is only available in development' });
    }
    
    try {
        const users = await prisma.user.findMany({
            where: { stripeCustomerId: { not: null } },
            select: { id: true, stripeCustomerId: true, email: true }
        });
        
        const results = [];
        for (const user of users) {
            try {
                await stripe.customers.retrieve(user.stripeCustomerId!);
                results.push({ userId: user.id, customerId: user.stripeCustomerId, status: 'valid' });
            } catch (error: any) {
                if (error.code === 'resource_missing') {
                    // Remove invalid customer ID
                    await prisma.user.update({
                        where: { id: user.id },
                        data: { stripeCustomerId: null }
                    });
                    results.push({ userId: user.id, customerId: user.stripeCustomerId, status: 'removed' });
                } else {
                    results.push({ userId: user.id, customerId: user.stripeCustomerId, status: 'error', error: error.message });
                }
            }
        }
        
        res.json({ results });
    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({ error: 'Cleanup failed' });
    }
}));

// Sync subscription status from Stripe (development only)
router.post('/sync-subscription', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ error: 'This endpoint is only available in development' });
    }
    
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { stripeCustomerId: true, subscriptionId: true }
        });
        
        if (!user?.stripeCustomerId) {
            return res.status(400).json({ error: 'No Stripe customer ID found' });
        }
        
        // Get customer from Stripe
        const customer = await stripe.customers.retrieve(user.stripeCustomerId);
        if ('deleted' in customer && customer.deleted) {
            return res.status(400).json({ error: 'Customer was deleted in Stripe' });
        }
        
        // Get subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
            customer: user.stripeCustomerId,
            limit: 1
        });
        
        if (subscriptions.data.length === 0) {
            return res.json({ message: 'No active subscriptions found' });
        }
        
        const subscription = subscriptions.data[0];
        console.log('Found subscription:', subscription.id, subscription.status);
        
        // Update user in database
        await prisma.user.update({
            where: { id: userId },
            data: {
                subscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                planType: subscription.status === 'active' ? 'premium' : 'free',
                subscriptionStart: new Date((subscription as any).current_period_start * 1000),
                subscriptionEnd: new Date((subscription as any).current_period_end * 1000)
            }
        });
        
        res.json({ 
            message: 'Subscription synced successfully',
            subscription: {
                id: subscription.id,
                status: subscription.status,
                currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
                currentPeriodEnd: new Date((subscription as any).current_period_end * 1000)
            }
        });
    } catch (error) {
        console.error('Sync subscription error:', error);
        res.status(500).json({ error: 'Failed to sync subscription' });
    }
}));

// Force sync subscription status from Stripe (production safe)
router.post('/force-sync-subscription', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { stripeCustomerId: true, subscriptionId: true, email: true }
        });
        
        if (!user?.stripeCustomerId) {
            return res.status(400).json({ error: 'No Stripe customer ID found' });
        }
        
        // Get customer from Stripe
        const customer = await stripe.customers.retrieve(user.stripeCustomerId);
        if ('deleted' in customer && customer.deleted) {
            return res.status(400).json({ error: 'Customer was deleted in Stripe' });
        }
        
        // Get subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
            customer: user.stripeCustomerId,
            limit: 1
        });
        
        if (subscriptions.data.length === 0) {
            // Reset to free plan if no subscriptions found
            await prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionId: null,
                    subscriptionStatus: null,
                    planType: 'free',
                    subscriptionStart: null,
                    subscriptionEnd: null
                }
            });
            return res.json({ 
                message: 'No active subscriptions found, reset to free plan',
                planType: 'free'
            });
        }
        
        const subscription = subscriptions.data[0];
        console.log('Found subscription:', subscription.id, subscription.status);
        
        // Update user in database
        await prisma.user.update({
            where: { id: userId },
            data: {
                subscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                planType: subscription.status === 'active' ? 'premium' : 'free',
                subscriptionStart: new Date((subscription as any).current_period_start * 1000),
                subscriptionEnd: new Date((subscription as any).current_period_end * 1000)
            }
        });
        
        res.json({ 
            message: 'Subscription synced successfully',
            subscription: {
                id: subscription.id,
                status: subscription.status,
                planType: subscription.status === 'active' ? 'premium' : 'free',
                currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
                currentPeriodEnd: new Date((subscription as any).current_period_end * 1000)
            }
        });
    } catch (error) {
        console.error('Force sync subscription error:', error);
        res.status(500).json({ error: 'Failed to sync subscription' });
    }
}));

// Debug and fix subscription issues (admin only)
router.post('/debug-subscription', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    
    try {
        // First, try to get the user from database
        const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                stripeCustomerId: true,
                subscriptionId: true,
                subscriptionStatus: true,
                planType: true,
                subscriptionStart: true,
                subscriptionEnd: true
            }
        });
        
        if (!dbUser) {
            return res.json({ error: 'User not found in database' });
        }
        
        console.log('Database user:', dbUser);
        
        if (!dbUser.stripeCustomerId) {
            return res.json({ error: 'No Stripe customer ID found' });
        }
        
        // Get customer from Stripe
        const customer = await stripe.customers.retrieve(dbUser.stripeCustomerId);
        console.log('Stripe customer:', {
            id: customer.id,
            email: 'email' in customer ? (customer as any).email : 'N/A',
            deleted: 'deleted' in customer ? (customer as any).deleted : false,
            metadata: 'metadata' in customer ? (customer as any).metadata : {}
        });
        
        // Check if customer is deleted or has issues
        if ('deleted' in customer && customer.deleted) {
            console.log('Customer is deleted in Stripe');
            return res.json({ 
                error: 'Customer is deleted in Stripe',
                details: 'The Stripe customer associated with this user has been deleted',
                customerId: dbUser.stripeCustomerId
            });
        }
        
        // Also check for any subscription history or events
        console.log('Checking customer subscription history...');
        
        // Get subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
            customer: dbUser.stripeCustomerId,
            limit: 10,
            status: 'all' // Include all statuses for debugging
        });
        
        // Also check for any payment intents or charges to see if there's payment activity
        try {
            const charges = await stripe.charges.list({
                customer: dbUser.stripeCustomerId,
                limit: 5
            });
            console.log(`Found ${charges.data.length} charges for customer`);
            
            if (charges.data.length > 0) {
                console.log('Recent charges:', charges.data.map(charge => ({
                    id: charge.id,
                    amount: charge.amount,
                    status: charge.status,
                    created: new Date(charge.created * 1000)
                })));
            }
        } catch (chargeError) {
            console.log('Could not retrieve charges:', chargeError);
        }
        
        console.log(`Found ${subscriptions.data.length} subscriptions`);
        
        // Log all subscriptions for debugging
        if (subscriptions.data.length > 0) {
            console.log('All subscriptions found:');
            subscriptions.data.forEach((sub, index) => {
                const subData = sub as any; // Type assertion for Stripe subscription
                console.log(`Subscription ${index + 1}:`, {
                    id: sub.id,
                    status: sub.status,
                    current_period_start: subData.current_period_start ? new Date(subData.current_period_start * 1000) : 'N/A',
                    current_period_end: subData.current_period_end ? new Date(subData.current_period_end * 1000) : 'N/A',
                    cancel_at_period_end: subData.cancel_at_period_end,
                    trial_end: subData.trial_end ? new Date(subData.trial_end * 1000) : 'N/A'
                });
            });
        }
        
        const activeSubscription = subscriptions.data.find(sub => sub.status === 'active');
        if (activeSubscription) {
            console.log('Active subscription found:', {
                id: activeSubscription.id,
                status: activeSubscription.status,
                current_period_start: new Date((activeSubscription as any).current_period_start * 1000),
                current_period_end: new Date((activeSubscription as any).current_period_end * 1000)
            });
            
            // Fix the user's subscription status
            await prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionId: activeSubscription.id,
                    subscriptionStatus: activeSubscription.status,
                    planType: 'premium',
                    subscriptionStart: new Date((activeSubscription as any).current_period_start * 1000),
                    subscriptionEnd: new Date((activeSubscription as any).current_period_end * 1000)
                }
            });
            
            console.log('User subscription status fixed!');
            return res.json({
                success: true,
                message: 'Subscription status fixed',
                subscription: {
                    id: activeSubscription.id,
                    status: activeSubscription.status,
                    planType: 'premium'
                }
            });
        } else {
            // Check if there are any subscriptions with other statuses that might be relevant
            const relevantSubscriptions = subscriptions.data.filter(sub => 
                ['trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired'].includes(sub.status)
            );
            
            if (relevantSubscriptions.length > 0) {
                console.log('Found relevant subscriptions with non-active status:');
                relevantSubscriptions.forEach(sub => {
                    console.log(`Status: ${sub.status}, ID: ${sub.id}`);
                });
                
                return res.json({ 
                    error: 'No active subscriptions found',
                    details: 'Found subscriptions with other statuses',
                                    subscriptions: relevantSubscriptions.map(sub => {
                    const subData = sub as any; // Type assertion for Stripe subscription
                    return {
                        id: sub.id,
                        status: sub.status,
                        current_period_end: subData.current_period_end ? new Date(subData.current_period_end * 1000) : null
                    };
                })
                });
            }
            
            console.log('No subscriptions found at all');
            return res.json({ 
                error: 'No active subscriptions found',
                details: 'No subscriptions found for this customer in Stripe',
                customerId: dbUser.stripeCustomerId,
                databaseStatus: {
                    planType: dbUser.planType,
                    subscriptionStatus: dbUser.subscriptionStatus,
                    subscriptionEnd: dbUser.subscriptionEnd
                }
            });
        }
        
    } catch (error) {
        console.error('Error debugging subscription:', error);
        return res.status(500).json({ error: 'Failed to debug subscription' });
    }
}));

// List users with subscription issues (admin only)
router.get('/list-subscription-issues', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const results = await listUsersWithSubscriptionIssues();
        res.json(results);
    } catch (error) {
        console.error('List subscription issues error:', error);
        res.status(500).json({ error: 'Failed to list subscription issues' });
    }
}));

// Check and fix expired subscriptions (admin only)
router.post('/check-expired-subscriptions', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    try {
        const results = await checkAndFixExpiredSubscriptions();
        res.json(results);
    } catch (error) {
        console.error('Check expired subscriptions error:', error);
        res.status(500).json({ error: 'Failed to check expired subscriptions' });
    }
}));

// Check and fix individual user subscription
router.post('/check-user-subscription', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    
    try {
        // Get user from database
        const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                stripeCustomerId: true,
                subscriptionId: true,
                subscriptionStatus: true,
                planType: true,
                subscriptionStart: true,
                subscriptionEnd: true
            }
        });
        
        if (!dbUser) {
            return res.json({ error: 'User not found in database' });
        }
        
        const result = await checkAndFixUserSubscription(dbUser);
        res.json(result);
    } catch (error) {
        console.error('Check user subscription error:', error);
        res.status(500).json({ error: 'Failed to check user subscription' });
    }
}));

// Test endpoint to verify Stripe and database configuration
router.get('/test-config', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    
    const config: any = {
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
        frontendUrlConfigured: !!process.env.FRONTEND_URL,
        priceIdConfigured: !!process.env.STRIPE_PRICE_ID_PREMIUM,
        userId: userId,
        userEmail: req.user?.email,
        userObject: req.user
    };

    try {
        // Test database connection
        const userCount = await prisma.user.count();
        config.databaseConnected = true;
        config.userTableExists = true;
        
        // Check if user exists in database
        if (userId) {
            const dbUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true, stripeCustomerId: true }
            });
            config.dbUser = dbUser;
        }
    } catch (error: any) {
        config.databaseConnected = false;
        config.userTableExists = false;
        config.databaseError = error.message;
    }

    // Test Stripe connection
    try {
        await stripe.customers.list({ limit: 1 });
        config.stripeConnected = true;
    } catch (error: any) {
        config.stripeConnected = false;
        config.stripeError = error.message;
    }

    res.json(config);
}));

// Create checkout session
router.post('/create-checkout-session', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    const { priceId } = req.body;

    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    // Get user email from JWT or database
    let userEmail = req.user?.email;
    console.log('Initial user email from JWT:', userEmail);
    
    if (!userEmail) {
        // Try to get email from database
        const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });
        userEmail = dbUser?.email;
        console.log('Email from database:', userEmail);
    }
    
    if (!userEmail) {
        console.error('User email is missing for user:', userId);
        // For development/testing, create a temporary email
        if (process.env.NODE_ENV === 'development') {
            userEmail = `temp-${userId}@example.com`;
            console.log('Using temporary email for development:', userEmail);
        } else {
            return res.status(400).json({ 
                error: 'User email is required for subscription setup',
                details: 'Please ensure your Auth0 configuration includes email scope and that the user has an email address.'
            });
        }
    }

    // Validate required environment variables
    if (!process.env.STRIPE_SECRET_KEY) {
        console.error('STRIPE_SECRET_KEY is not configured');
        return res.status(500).json({ error: 'Stripe configuration error' });
    }

    if (!process.env.FRONTEND_URL) {
        console.error('FRONTEND_URL is not configured');
        return res.status(500).json({ error: 'Frontend URL configuration error' });
    }

    try {
        console.log('Creating checkout session for user:', userId);
        console.log('User email:', userEmail);
        console.log('Price ID:', priceId || process.env.STRIPE_PRICE_ID_PREMIUM);

        // Get or create Stripe customer
        let user = await prisma.user.findUnique({ where: { id: userId } });
        let customerId = user?.stripeCustomerId;

        if (!customerId) {
            console.log('Creating new Stripe customer for user:', userId);
            
            // userEmail is already validated above
            
            const customer = await stripe.customers.create({
                metadata: { userId },
                email: userEmail
            });
            customerId = customer.id;
            console.log('Created Stripe customer:', customerId);
            
            // Create or update user in database
            try {
                await prisma.user.upsert({
                    where: { id: userId },
                    update: { 
                        stripeCustomerId: customerId,
                        email: userEmail 
                    },
                    create: { 
                        id: userId,
                        email: userEmail,
                        stripeCustomerId: customerId 
                    }
                });
                console.log('User record updated in database');
            } catch (dbError) {
                console.error('Database error updating user:', dbError);
                // Continue with Stripe session creation even if DB update fails
            }
        } else {
            console.log('Using existing Stripe customer:', customerId);
            
            // Verify the customer exists in Stripe
            try {
                const customer = await stripe.customers.retrieve(customerId);
                console.log('Stripe customer verified:', customerId);
                
                // Check if customer is deleted
                if ('deleted' in customer && customer.deleted) {
                    throw new Error('Customer was deleted');
                }
                
                // Type guard to ensure customer is not deleted
                if ('email' in customer) {
                    const validCustomer = customer as any;
                    console.log('Customer details:', { id: validCustomer.id, email: validCustomer.email, deleted: false });
                } else {
                    throw new Error('Customer is deleted or invalid');
                }
            } catch (stripeError: any) {
                console.error('Stripe customer not found or invalid, creating new one:', customerId);
                console.error('Stripe error:', stripeError.message);
                
                // Create new customer
                const customer = await stripe.customers.create({
                    metadata: { userId },
                    email: userEmail
                });
                customerId = customer.id;
                console.log('Created new Stripe customer:', customerId);
                
                // Update database with new customer ID
                try {
                    await prisma.user.update({
                        where: { id: userId },
                        data: { 
                            stripeCustomerId: customerId,
                            email: userEmail 
                        }
                    });
                    console.log('Database updated with new customer ID');
                } catch (dbError) {
                    console.error('Database error updating customer ID:', dbError);
                    // Continue with Stripe session creation even if DB update fails
                }
            }
        }

        // Validate price ID
        const finalPriceId = priceId || process.env.STRIPE_PRICE_ID_PREMIUM;
        if (!finalPriceId) {
            console.error('No price ID provided and STRIPE_PRICE_ID_PREMIUM not configured');
            return res.status(400).json({ error: 'Price ID is required' });
        }

        // Create checkout session
        console.log('Creating Stripe checkout session with customer:', customerId);
        try {
            const session = await stripe.checkout.sessions.create({
                customer: customerId,
                payment_method_types: ['card'],
                mode: 'subscription',
                line_items: [{
                    price: finalPriceId,
                    quantity: 1,
                }],
                success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`,
                allow_promotion_codes: true,
                billing_address_collection: 'auto',
            });

            console.log('Checkout session created successfully:', session.id);
            res.json({ sessionId: session.id });
        } catch (sessionError: any) {
            console.error('Checkout session creation failed:', sessionError.message);
            
            // If the error is about the customer, try creating a new customer
            if (sessionError.code === 'resource_missing' && sessionError.param === 'customer') {
                console.log('Customer not found in checkout session, creating new customer...');
                
                // Create new customer
                const newCustomer = await stripe.customers.create({
                    metadata: { userId },
                    email: userEmail
                });
                
                console.log('Created new customer for checkout:', newCustomer.id);
                
                // Update database
                try {
                    await prisma.user.update({
                        where: { id: userId },
                        data: { 
                            stripeCustomerId: newCustomer.id,
                            email: userEmail 
                        }
                    });
                } catch (dbError) {
                    console.error('Database error updating customer ID:', dbError);
                }
                
                // Try creating checkout session again with new customer
                const retrySession = await stripe.checkout.sessions.create({
                    customer: newCustomer.id,
                    payment_method_types: ['card'],
                    mode: 'subscription',
                    line_items: [{
                        price: finalPriceId,
                        quantity: 1,
                    }],
                    success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`,
                    allow_promotion_codes: true,
                    billing_address_collection: 'auto',
                });
                
                console.log('Checkout session created successfully with new customer:', retrySession.id);
                res.json({ sessionId: retrySession.id });
            } else {
                // Re-throw the error to be handled by the outer catch block
                throw sessionError;
            }
        }
    } catch (error: any) {
        console.error('Detailed error creating checkout session:', {
            message: error.message,
            type: error.type,
            code: error.code,
            param: error.param,
            stack: error.stack
        });
        
        // Return more specific error messages
        if (error.type === 'StripeInvalidRequestError') {
            if (error.code === 'resource_missing' && error.param === 'customer') {
                return res.status(400).json({ 
                    error: 'Invalid customer ID in database', 
                    details: process.env.NODE_ENV === 'development' ? 'The stored customer ID does not exist in Stripe. Please try again.' : undefined 
                });
            }
            return res.status(400).json({ 
                error: 'Invalid Stripe request', 
                details: process.env.NODE_ENV === 'development' ? error.message : undefined 
            });
        }
        
        if (error.code === 'price_not_found') {
            return res.status(400).json({ 
                error: 'Invalid price ID', 
                details: process.env.NODE_ENV === 'development' ? 'The specified price was not found' : undefined 
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to create checkout session', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
}));

// Get subscription status
router.get('/subscription-status', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                planType: true,
                subscriptionStatus: true,
                subscriptionStart: true,
                subscriptionEnd: true,
                stripeCustomerId: true,
                subscriptionId: true
            }
        });

        if (!user) {
            return res.json({
                planType: 'free',
                subscriptionStatus: null,
                subscriptionStart: null,
                subscriptionEnd: null
            });
        }

        res.json(user);
    } catch (error) {
        handleDatabaseError(error, res, 'fetch subscription status');
    }
}));

// Cancel subscription
router.post('/cancel-subscription', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    if (!userId) {
        handleUnauthorized(res);
        return;
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { subscriptionId: true }
        });

        if (!user?.subscriptionId) {
            return res.status(400).json({ error: 'No active subscription found' });
        }

        await stripe.subscriptions.cancel(user.subscriptionId);
        res.json({ message: 'Subscription canceled successfully' });
    } catch (error) {
        handleGenericError(error, res, 'cancel subscription');
    }
}));



async function handleWebhookEvent(event: any) {
    console.log('Processing webhook event:', event.type);
    
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object as any;
            await handleCheckoutSessionCompleted(session);
            break;
            
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            const subscription = event.data.object as any;
            await handleSubscriptionUpdate(subscription);
            break;
        
        case 'customer.subscription.deleted':
            const deletedSubscription = event.data.object as any;
            await handleSubscriptionCancellation(deletedSubscription);
            break;
        
        case 'invoice.payment_succeeded':
            const successfulInvoice = event.data.object as any;
            await handlePaymentSuccess(successfulInvoice);
            break;
        
        case 'invoice.created':
            const createdInvoice = event.data.object as any;
            await handleInvoiceCreated(createdInvoice);
            break;
        
        case 'invoice.payment_failed':
            const failedInvoice = event.data.object as any;
            await handlePaymentFailure(failedInvoice);
            break;
        
        default:
            console.log(`Unhandled event type ${event.type}`);
    }
}

async function handleCheckoutSessionCompleted(session: any) {
    console.log('Handling checkout session completed:', session.id);
    
    try {
        const customerId = session.customer;
        if (!customerId) {
            console.error('No customer ID in checkout session');
            return;
        }
        
        // Get customer details
        const customer = await stripe.customers.retrieve(customerId);
        if ('deleted' in customer && customer.deleted) {
            console.error('Customer was deleted');
            return;
        }
        
        const userId = customer.metadata?.userId;
        if (!userId) {
            console.error('No userId in customer metadata');
            return;
        }
        
        // Get subscription details
        const subscriptionId = session.subscription;
        if (!subscriptionId) {
            console.error('No subscription ID in checkout session');
            return;
        }
        
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        console.log('Retrieved subscription:', subscription.id, subscription.status);
        
        // Check if user exists in database, if not create them
        const existingUser = await prisma.user.findUnique({
            where: { id: userId }
        });
        
        if (!existingUser) {
            console.log('Creating new user record for:', userId);
            await prisma.user.create({
                data: {
                    id: userId,
                    email: 'email' in customer ? (customer as any).email : `user-${userId}@example.com`,
                    stripeCustomerId: customerId,
                    subscriptionId: subscription.id,
                    subscriptionStatus: subscription.status,
                    planType: subscription.status === 'active' ? 'premium' : 'free',
                    subscriptionStart: new Date((subscription as any).current_period_start * 1000),
                    subscriptionEnd: new Date((subscription as any).current_period_end * 1000)
                }
            });
        } else {
            // Update existing user
            await prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionId: subscription.id,
                    subscriptionStatus: subscription.status,
                    planType: subscription.status === 'active' ? 'premium' : 'free',
                    subscriptionStart: new Date((subscription as any).current_period_start * 1000),
                    subscriptionEnd: new Date((subscription as any).current_period_end * 1000),
                    stripeCustomerId: customerId,
                    email: 'email' in customer ? (customer as any).email : existingUser.email
                }
            });
        }
        
        console.log('User subscription updated successfully for user:', userId);
    } catch (error) {
        console.error('Error handling checkout session completed:', error);
        // Log more details for debugging
        console.error('Session details:', {
            id: session.id,
            customer: session.customer,
            subscription: session.subscription,
            payment_status: session.payment_status
        });
    }
}

async function handleSubscriptionUpdate(subscription: any) {
    console.log('Handling subscription update:', subscription.id, subscription.status);
    const customerId = subscription.customer as string;
    
    try {
        const customer = await stripe.customers.retrieve(customerId);
        
        if ('deleted' in customer && customer.deleted) {
            console.error('Customer was deleted');
            return;
        }
        
        const userId = customer.metadata?.userId;
        if (!userId) {
            console.error('No userId in customer metadata');
            return;
        }
        
        // Check if user exists in database, if not create them
        const existingUser = await prisma.user.findUnique({
            where: { id: userId }
        });
        
        // Get subscription details to access period dates
        const subscriptionDetails = subscription as any;
        const updateData = {
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            planType: subscription.status === 'active' ? 'premium' : 'free',
            subscriptionStart: subscriptionDetails.current_period_start ? new Date(subscriptionDetails.current_period_start * 1000) : new Date(),
            subscriptionEnd: subscriptionDetails.current_period_end ? new Date(subscriptionDetails.current_period_end * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default to 30 days
            stripeCustomerId: customerId,
            email: 'email' in customer ? (customer as any).email : (existingUser?.email || `user-${userId}@example.com`)
        };
        
        if (!existingUser) {
            console.log('Creating new user record for subscription update:', userId);
            await prisma.user.create({
                data: {
                    id: userId,
                    ...updateData
                }
            });
        } else {
            await prisma.user.update({
                where: { id: userId },
                data: updateData
            });
        }
        
        console.log('User subscription updated successfully for user:', userId);
    } catch (error) {
        console.error('Error handling subscription update:', error);
        // Log more details for debugging
        console.error('Subscription details:', {
            id: subscription.id,
            status: subscription.status,
            customer: subscription.customer
        });
    }
}

async function handleSubscriptionCancellation(subscription: any) {
    const customerId = subscription.customer as string;
    
    try {
        const customer = await stripe.customers.retrieve(customerId);
        
        if (customer.deleted) {
            console.error('Customer was deleted');
            return;
        }
        
        const userId = customer.metadata?.userId;
        if (!userId) {
            console.error('No userId in customer metadata');
            return;
        }
        
        // Check if user exists in database, if not create them
        const existingUser = await prisma.user.findUnique({
            where: { id: userId }
        });
        
        if (!existingUser) {
            console.log('Creating new user record for subscription cancellation:', userId);
            await prisma.user.create({
                data: {
                    id: userId,
                    email: 'email' in customer ? (customer as any).email : `user-${userId}@example.com`,
                    stripeCustomerId: customerId,
                    subscriptionStatus: 'canceled',
                    planType: 'free',
                    subscriptionEnd: new Date(),
                }
            });
        } else {
            await prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionStatus: 'canceled',
                    planType: 'free',
                    subscriptionEnd: new Date(),
                }
            });
        }
    } catch (error) {
        console.error('Error handling subscription cancellation:', error);
    }
}

async function handleInvoiceCreated(invoice: any) {
    console.log('Handling invoice created:', invoice.id);
    const customerId = invoice.customer as string;
    
    try {
        const customer = await stripe.customers.retrieve(customerId);
        
        if ('deleted' in customer && customer.deleted) {
            console.error('Customer was deleted');
            return;
        }
        
        const userId = customer.metadata?.userId;
        if (!userId) {
            console.error('No userId in customer metadata');
            return;
        }
        
        // Get the subscription ID from the invoice
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) {
            console.error('No subscription ID in invoice');
            return;
        }
        
        // Retrieve the subscription to get current status and period details
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        console.log('Retrieved subscription for invoice created:', subscription.id, subscription.status);
        
        // Check if user exists in database, if not create them
        const existingUser = await prisma.user.findUnique({
            where: { id: userId }
        });
        
        const updateData = {
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            planType: subscription.status === 'active' ? 'premium' : 'free',
            subscriptionStart: new Date((subscription as any).current_period_start * 1000),
            subscriptionEnd: new Date((subscription as any).current_period_end * 1000),
            stripeCustomerId: customerId,
            email: 'email' in customer ? (customer as any).email : (existingUser?.email || `user-${userId}@example.com`)
        };
        
        if (!existingUser) {
            console.log('Creating new user record for invoice created:', userId);
            await prisma.user.create({
                data: {
                    id: userId,
                    ...updateData
                }
            });
        } else {
            await prisma.user.update({
                where: { id: userId },
                data: updateData
            });
        }
        
        console.log('User subscription updated successfully for invoice created, user:', userId);
    } catch (error) {
        console.error('Error handling invoice created:', error);
    }
}

async function handlePaymentSuccess(invoice: any) {
    console.log('Handling payment success for invoice:', invoice.id);
    const customerId = invoice.customer as string;
    
    try {
        const customer = await stripe.customers.retrieve(customerId);
        
        if ('deleted' in customer && customer.deleted) {
            console.error('Customer was deleted');
            return;
        }
        
        const userId = customer.metadata?.userId;
        if (!userId) {
            console.error('No userId in customer metadata');
            return;
        }
        
        // Get the subscription ID from the invoice
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) {
            console.error('No subscription ID in invoice');
            return;
        }
        
        // Retrieve the subscription to get current status and period details
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        console.log('Retrieved subscription for payment success:', subscription.id, subscription.status);
        
        // Check if user exists in database, if not create them
        const existingUser = await prisma.user.findUnique({
            where: { id: userId }
        });
        
        const updateData = {
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            planType: subscription.status === 'active' ? 'premium' : 'free',
            subscriptionStart: new Date((subscription as any).current_period_start * 1000),
            subscriptionEnd: new Date((subscription as any).current_period_end * 1000),
            stripeCustomerId: customerId,
            email: 'email' in customer ? (customer as any).email : (existingUser?.email || `user-${userId}@example.com`)
        };
        
        if (!existingUser) {
            console.log('Creating new user record for payment success:', userId);
            await prisma.user.create({
                data: {
                    id: userId,
                    ...updateData
                }
            });
        } else {
            await prisma.user.update({
                where: { id: userId },
                data: updateData
            });
        }
        
        console.log('User subscription updated successfully for payment success, user:', userId);
    } catch (error) {
        console.error('Error handling payment success:', error);
    }
}

async function handlePaymentFailure(invoice: any) {
    const customerId = invoice.customer as string;
    
    try {
        const customer = await stripe.customers.retrieve(customerId);
        
        if (customer.deleted) {
            console.error('Customer was deleted');
            return;
        }
        
        const userId = customer.metadata?.userId;
        if (!userId) {
            console.error('No userId in customer metadata');
            return;
        }
        
        // Check if user exists in database, if not create them
        const existingUser = await prisma.user.findUnique({
            where: { id: userId }
        });
        
        if (!existingUser) {
            console.log('Creating new user record for payment failure:', userId);
            await prisma.user.create({
                data: {
                    id: userId,
                    email: 'email' in customer ? (customer as any).email : `user-${userId}@example.com`,
                    stripeCustomerId: customerId,
                    subscriptionStatus: 'past_due',
                }
            });
        } else {
            await prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionStatus: 'past_due',
                }
            });
        }
    } catch (error) {
        console.error('Error handling payment failure:', error);
    }
}

export { handleWebhookEvent };
export default router;
