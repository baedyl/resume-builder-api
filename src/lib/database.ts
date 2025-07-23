import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
        ? [{ emit: 'stdout', level: 'query' }, { emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }]
        : [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
});

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

// Handle events for production logging
if (process.env.NODE_ENV === 'production') {
    (prisma as any).$on('error', (e: any) => {
        console.error('Prisma client error:', e);
    });
    
    (prisma as any).$on('warn', (e: any) => {
        console.warn('Prisma client warning:', e);
    });
}

export default prisma; 