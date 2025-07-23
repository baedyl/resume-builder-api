import express from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { ensureAuthenticated } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const prisma = new PrismaClient();
const router = express.Router();

// Test endpoint to verify Stripe and database configuration
router.get('/test-config', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    
    const config: any = {
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
        frontendUrlConfigured: !!process.env.FRONTEND_URL,
        priceIdConfigured: !!process.env.STRIPE_PRICE_ID_PREMIUM,
        userId: userId
    };

    try {
        // Test database connection
        const userCount = await prisma.user.count();
        config.databaseConnected = true;
        config.userTableExists = true;
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
        return res.status(401).json({ error: 'Unauthorized' });
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
        console.log('Price ID:', priceId || process.env.STRIPE_PRICE_ID_PREMIUM);

        // Get or create Stripe customer
        let user = await prisma.user.findUnique({ where: { id: userId } });
        let customerId = user?.stripeCustomerId;

        if (!customerId) {
            console.log('Creating new Stripe customer for user:', userId);
            const customer = await stripe.customers.create({
                metadata: { userId },
                email: req.user?.email || undefined
            });
            customerId = customer.id;
            console.log('Created Stripe customer:', customerId);
            
            await prisma.user.upsert({
                where: { id: userId },
                update: { stripeCustomerId: customerId },
                create: { 
                    id: userId,
                    email: req.user?.email || '',
                    stripeCustomerId: customerId 
                }
            });
        } else {
            console.log('Using existing Stripe customer:', customerId);
        }

        // Validate price ID
        const finalPriceId = priceId || process.env.STRIPE_PRICE_ID_PREMIUM;
        if (!finalPriceId) {
            console.error('No price ID provided and STRIPE_PRICE_ID_PREMIUM not configured');
            return res.status(400).json({ error: 'Price ID is required' });
        }

        // Create checkout session
        console.log('Creating Stripe checkout session...');
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
            return res.status(400).json({ 
                error: 'Invalid request to Stripe', 
                details: error.message 
            });
        }
        
        if (error.code === 'price_not_found') {
            return res.status(400).json({ 
                error: 'Invalid price ID provided' 
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
    
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            planType: true,
            subscriptionStatus: true,
            subscriptionEnd: true,
            subscriptionStart: true
        }
    });

    res.json(user || { planType: 'free' });
}));

// Cancel subscription
router.post('/cancel-subscription', ensureAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.sub;
    
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionId: true }
    });

    if (!user?.subscriptionId) {
        return res.status(404).json({ error: 'No subscription found' });
    }

    await stripe.subscriptions.cancel(user.subscriptionId);
    res.json({ message: 'Subscription canceled successfully' });
}));

// Stripe webhook handler
router.post('/webhook', (req: any, res: any) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

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

async function handleWebhookEvent(event: Stripe.Event) {
    switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            const subscription = event.data.object as Stripe.Subscription;
            await handleSubscriptionUpdate(subscription);
            break;
        
        case 'customer.subscription.deleted':
            const deletedSubscription = event.data.object as Stripe.Subscription;
            await handleSubscriptionCancellation(deletedSubscription);
            break;
        
        case 'invoice.payment_failed':
            const failedInvoice = event.data.object as Stripe.Invoice;
            await handlePaymentFailure(failedInvoice);
            break;
    }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
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

async function handleSubscriptionCancellation(subscription: Stripe.Subscription) {
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
                }
            });
        }
    } catch (error) {
        console.error('Error handling subscription cancellation:', error);
    }
}

async function handlePaymentFailure(invoice: Stripe.Invoice) {
    // Handle payment failure logic
    console.log('Payment failed for invoice:', invoice.id);
}

export default router;
