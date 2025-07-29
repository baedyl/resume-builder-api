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

// Stripe webhook handler
router.post('/webhook', (req: any, res: any) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: any;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
        console.log(`Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    handleWebhookEvent(event).then(() => {
        res.json({ received: true });
    }).catch((error) => {
        console.error('Webhook handling error:', error);
        res.status(500).json({ error: 'Webhook handling failed' });
    });
});

async function handleWebhookEvent(event: any) {
    switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            const subscription = event.data.object as any;
            await handleSubscriptionUpdate(subscription);
            break;
        
        case 'customer.subscription.deleted':
            const deletedSubscription = event.data.object as any;
            await handleSubscriptionCancellation(deletedSubscription);
            break;
        
        case 'invoice.payment_failed':
            const failedInvoice = event.data.object as any;
            await handlePaymentFailure(failedInvoice);
            break;
        
        default:
            console.log(`Unhandled event type ${event.type}`);
    }
}

async function handleSubscriptionUpdate(subscription: any) {
    const customerId = subscription.customer as string;
    
    try {
        const customer = await stripe.customers.retrieve(customerId);
        
        if (customer.deleted) {
            console.error('Customer was deleted');
            return;
        }
        
        if (customer.metadata?.userId) {
            // Get subscription details to access period dates
            const subscriptionDetails = subscription as any;
            await prisma.user.update({
                where: { id: customer.metadata.userId },
                data: {
                    subscriptionId: subscription.id,
                    subscriptionStatus: subscription.status,
                    planType: 'premium',
                    subscriptionStart: subscriptionDetails.current_period_start ? new Date(subscriptionDetails.current_period_start * 1000) : new Date(),
                    subscriptionEnd: subscriptionDetails.current_period_end ? new Date(subscriptionDetails.current_period_end * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default to 30 days
                }
            });
        }
    } catch (error) {
        console.error('Error handling subscription update:', error);
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
        
        if (customer.metadata?.userId) {
            await prisma.user.update({
                where: { id: customer.metadata.userId },
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

async function handlePaymentFailure(invoice: any) {
    const customerId = invoice.customer as string;
    
    try {
        const customer = await stripe.customers.retrieve(customerId);
        
        if (customer.deleted) {
            console.error('Customer was deleted');
            return;
        }
        
        if (customer.metadata?.userId) {
            await prisma.user.update({
                where: { id: customer.metadata.userId },
                data: {
                    subscriptionStatus: 'past_due',
                }
            });
        }
    } catch (error) {
        console.error('Error handling payment failure:', error);
    }
}

export default router;
