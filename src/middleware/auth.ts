import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

// Initialize JWKS client
const client = jwksClient({
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
});

// Retrieve the signing key
function getKey(header: any, callback: any) {
    client.getSigningKey(header.kid, (err, key) => {
        if (err) {
            console.log({ error: 'Invalid token' });
        } 
        const signingKey = key?.getPublicKey();
        callback(null, signingKey);
    });
}

// Authentication middleware
export const ensureAuthenticated = (req: Request, res: Response, next: NextFunction): void => {
    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return; // Explicit return to end the function here
    }

    // Extract token
    const token = authHeader.split(' ')[1];

    // Verify token
    jwt.verify(token, getKey, {
        audience: process.env.AUTH0_AUDIENCE,
        issuer: `https://${process.env.AUTH0_DOMAIN}/`,
        algorithms: ['RS256']
    }, (err: Error | null, decoded: any) => {
        if (err) {
            res.status(401).json({ error: 'Invalid token' });
        } else {
            req.user = decoded;
            next();
        }
    });
};