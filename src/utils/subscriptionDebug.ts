import { prisma } from '../lib/database';
import { stripe } from '../lib/stripe';

export async function debugUserSubscription(userId: string) {
    console.log(`Debugging subscription for user: ${userId}`);
    
    try {
        // Get user from database
        const user = await prisma.user.findUnique({
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
        const customer = await stripe.customers.retrieve(user.stripeCustomerId);
        console.log('Stripe customer:', {
            id: customer.id,
            email: 'email' in customer ? (customer as any).email : 'N/A',
            deleted: 'deleted' in customer ? (customer as any).deleted : false,
            metadata: 'metadata' in customer ? (customer as any).metadata : {}
        });
        
        // Get subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
            customer: user.stripeCustomerId,
            limit: 10
        });
        
        console.log(`Found ${subscriptions.data.length} subscriptions`);
        
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
            return {
                success: true,
                message: 'Subscription status fixed',
                subscription: {
                    id: activeSubscription.id,
                    status: activeSubscription.status,
                    planType: 'premium'
                }
            };
        } else {
            console.log('No active subscriptions found');
            return { error: 'No active subscriptions found' };
        }
        
    } catch (error) {
        console.error('Error debugging subscription:', error);
        return { error: 'Failed to debug subscription' };
    }
}

export async function listUsersWithSubscriptionIssues() {
    console.log('Finding users with potential subscription issues...');
    
    try {
        // Find users who have Stripe customer IDs but might have subscription issues
        const users = await prisma.user.findMany({
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
                const customer = await stripe.customers.retrieve(user.stripeCustomerId!);
                const subscriptions = await stripe.subscriptions.list({
                    customer: user.stripeCustomerId!,
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
            } catch (error) {
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
    } catch (error) {
        console.error('Error listing users with issues:', error);
        return { error: 'Failed to list users' };
    }
} 