// src/types/express.d.ts
declare module 'express-serve-static-core' {
    interface Request {
        user?: {
            sub: string;
            // Add other properties from your decoded token as needed
        };
    }
}