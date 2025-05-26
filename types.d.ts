declare module 'express-serve-static-core' {
    interface Request {
        user?: any; // Replace 'any' with a specific type if you know the token payload structure
    }
}