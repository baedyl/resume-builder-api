"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugUserSubscription = debugUserSubscription;
exports.listUsersWithSubscriptionIssues = listUsersWithSubscriptionIssues;
exports.checkAndFixExpiredSubscriptions = checkAndFixExpiredSubscriptions;
exports.checkAndFixUserSubscription = checkAndFixUserSubscription;
const database_1 = require("../lib/database");
const stripe_1 = require("../lib/stripe");
async function debugUserSubscription(userId) {
    console.log(`Debugging subscription for user: ${userId}`);
    try {
        // Get user from database
        const user = await database_1.prisma.user.findUnique({
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
        if (!user) {
            console.log('User not found in database');
            return { error: 'User not found' };
        }
        console.log('Database user:', user);
        if (!user.stripeCustomerId) {
            console.log('No Stripe customer ID found');
            return { error: 'No Stripe customer ID' };
        }
        // Get customer from Stripe
        const customer = await stripe_1.stripe.customers.retrieve(user.stripeCustomerId);
        console.log('Stripe customer:', {
            id: customer.id,
            email: 'email' in customer ? customer.email : 'N/A',
            deleted: 'deleted' in customer ? customer.deleted : false,
            metadata: 'metadata' in customer ? customer.metadata : {}
        });
        // Get subscriptions for this customer
        const subscriptions = await stripe_1.stripe.subscriptions.list({
            customer: user.stripeCustomerId,
            limit: 10
        });
        console.log(`Found ${subscriptions.data.length} subscriptions`);
        const activeSubscription = subscriptions.data.find(sub => sub.status === 'active');
        if (activeSubscription) {
            console.log('Active subscription found:', {
                id: activeSubscription.id,
                status: activeSubscription.status,
                current_period_start: new Date(activeSubscription.current_period_start * 1000),
                current_period_end: new Date(activeSubscription.current_period_end * 1000)
            });
            // Fix the user's subscription status
            await database_1.prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionId: activeSubscription.id,
                    subscriptionStatus: activeSubscription.status,
                    planType: 'premium',
                    subscriptionStart: new Date(activeSubscription.current_period_start * 1000),
                    subscriptionEnd: new Date(activeSubscription.current_period_end * 1000)
                }
            });
            console.log('User subscription status fixed!');
            return {
                success: true,
                message: 'Subscription status fixed',
                subscription: {
                    id: activeSubscription.id,
                    status: activeSubscription.status,
                    planType: 'premium'
                }
            };
        }
        else {
            console.log('No active subscriptions found');
            return { error: 'No active subscriptions found' };
        }
    }
    catch (error) {
        console.error('Error debugging subscription:', error);
        return { error: 'Failed to debug subscription' };
    }
}
async function listUsersWithSubscriptionIssues() {
    console.log('Finding users with potential subscription issues...');
    try {
        // Find users who have Stripe customer IDs but might have subscription issues
        const users = await database_1.prisma.user.findMany({
            where: {
                stripeCustomerId: { not: null },
                OR: [
                    { subscriptionStatus: null },
                    { subscriptionStatus: 'inactive' },
                    { planType: 'free' }
                ]
            },
            select: {
                id: true,
                email: true,
                stripeCustomerId: true,
                subscriptionId: true,
                subscriptionStatus: true,
                planType: true
            }
        });
        console.log(`Found ${users.length} users with potential issues`);
        const results = [];
        for (const user of users) {
            try {
                const customer = await stripe_1.stripe.customers.retrieve(user.stripeCustomerId);
                const subscriptions = await stripe_1.stripe.subscriptions.list({
                    customer: user.stripeCustomerId,
                    limit: 1
                });
                const hasActiveSubscription = subscriptions.data.some(sub => sub.status === 'active');
                results.push({
                    userId: user.id,
                    email: user.email,
                    stripeCustomerId: user.stripeCustomerId,
                    dbSubscriptionStatus: user.subscriptionStatus,
                    dbPlanType: user.planType,
                    hasActiveSubscription,
                    needsFix: hasActiveSubscription && user.planType === 'free'
                });
            }
            catch (error) {
                results.push({
                    userId: user.id,
                    email: user.email,
                    stripeCustomerId: user.stripeCustomerId,
                    dbSubscriptionStatus: user.subscriptionStatus,
                    dbPlanType: user.planType,
                    hasActiveSubscription: false,
                    needsFix: false,
                    error: 'Failed to check Stripe'
                });
            }
        }
        return results;
    }
    catch (error) {
        console.error('Error listing users with issues:', error);
        return { error: 'Failed to list users' };
    }
}
async function checkAndFixExpiredSubscriptions() {
    console.log('Checking for expired subscriptions...');
    try {
        // Find all users with premium subscriptions that might be expired
        const premiumUsers = await database_1.prisma.user.findMany({
            where: {
                planType: 'premium',
                subscriptionStatus: 'active',
                subscriptionEnd: {
                    not: null
                }
            },
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
        console.log(`Found ${premiumUsers.length} premium users to check`);
        const results = [];
        for (const user of premiumUsers) {
            try {
                const result = await checkAndFixUserSubscription(user);
                results.push(result);
            }
            catch (error) {
                console.error(`Error checking user ${user.id}:`, error);
                results.push({
                    userId: user.id,
                    email: user.email,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        return {
            totalChecked: premiumUsers.length,
            results
        };
    }
    catch (error) {
        console.error('Error checking expired subscriptions:', error);
        throw error;
    }
}
async function checkAndFixUserSubscription(user) {
    console.log(`Checking subscription for user: ${user.email}`);
    try {
        // Check if subscription has expired based on subscriptionEnd date
        const now = new Date();
        const subscriptionEnd = new Date(user.subscriptionEnd);
        const isExpired = subscriptionEnd < now;
        if (!isExpired) {
            console.log(`User ${user.email} subscription is still active until ${subscriptionEnd.toISOString()}`);
            return {
                userId: user.id,
                email: user.email,
                status: 'active',
                subscriptionEnd: user.subscriptionEnd,
                daysRemaining: Math.ceil((subscriptionEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            };
        }
        console.log(`User ${user.email} subscription expired on ${subscriptionEnd.toISOString()}`);
        // Check Stripe for actual subscription status
        if (user.stripeCustomerId) {
            try {
                const stripe = require('../lib/stripe').stripe;
                const customer = await stripe.customers.retrieve(user.stripeCustomerId);
                if ('deleted' in customer && customer.deleted) {
                    console.log(`Customer ${user.stripeCustomerId} is deleted in Stripe`);
                    await updateUserToExpired(user.id, 'customer_deleted');
                    return {
                        userId: user.id,
                        email: user.email,
                        status: 'expired',
                        reason: 'customer_deleted',
                        message: 'Stripe customer was deleted'
                    };
                }
                // Check for active subscriptions in Stripe
                const subscriptions = await stripe.subscriptions.list({
                    customer: user.stripeCustomerId,
                    status: 'active',
                    limit: 1
                });
                if (subscriptions.data.length > 0) {
                    // User has an active subscription in Stripe, update database
                    const activeSub = subscriptions.data[0];
                    console.log(`Found active subscription in Stripe: ${activeSub.id}`);
                    await database_1.prisma.user.update({
                        where: { id: user.id },
                        data: {
                            subscriptionId: activeSub.id,
                            subscriptionStatus: activeSub.status,
                            planType: 'premium',
                            subscriptionStart: new Date(activeSub.current_period_start * 1000),
                            subscriptionEnd: new Date(activeSub.current_period_end * 1000)
                        }
                    });
                    return {
                        userId: user.id,
                        email: user.email,
                        status: 'fixed',
                        message: 'Subscription status updated from Stripe',
                        newEndDate: new Date(activeSub.current_period_end * 1000)
                    };
                }
                else {
                    // No active subscription in Stripe, mark as expired
                    console.log(`No active subscription found in Stripe for user ${user.email}`);
                    await updateUserToExpired(user.id, 'subscription_expired');
                    return {
                        userId: user.id,
                        email: user.email,
                        status: 'expired',
                        reason: 'subscription_expired',
                        message: 'Subscription expired and not renewed'
                    };
                }
            }
            catch (stripeError) {
                console.error(`Stripe error for user ${user.email}:`, stripeError);
                // If we can't check Stripe, mark as expired based on date
                await updateUserToExpired(user.id, 'date_expired');
                return {
                    userId: user.id,
                    email: user.email,
                    status: 'expired',
                    reason: 'date_expired',
                    message: 'Subscription expired based on end date'
                };
            }
        }
        else {
            // No Stripe customer ID, mark as expired
            console.log(`No Stripe customer ID for user ${user.email}`);
            await updateUserToExpired(user.id, 'no_stripe_customer');
            return {
                userId: user.id,
                email: user.email,
                status: 'expired',
                reason: 'no_stripe_customer',
                message: 'No Stripe customer associated'
            };
        }
    }
    catch (error) {
        console.error(`Error checking user subscription ${user.id}:`, error);
        throw error;
    }
}
async function updateUserToExpired(userId, reason) {
    console.log(`Updating user ${userId} to expired status. Reason: ${reason}`);
    await database_1.prisma.user.update({
        where: { id: userId },
        data: {
            planType: 'free',
            subscriptionStatus: 'expired',
            // Keep the subscriptionEnd date for reference
        }
    });
    console.log(`User ${userId} updated to expired status`);
}
