"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const globalForPrisma = globalThis;
exports.prisma = (_a = globalForPrisma.prisma) !== null && _a !== void 0 ? _a : new client_1.PrismaClient({
    log: process.env.NODE_ENV === 'development'
        ? [{ emit: 'stdout', level: 'query' }, { emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }]
        : [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
});
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = exports.prisma;
}
// Handle events for production logging
if (process.env.NODE_ENV === 'production') {
    exports.prisma.$on('error', (e) => {
        console.error('Prisma client error:', e);
    });
    exports.prisma.$on('warn', (e) => {
        console.warn('Prisma client warning:', e);
    });
}
exports.default = exports.prisma;
