import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

// Initialize JWKS client
const client = jwksClient({
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
});

// Function to retrieve the signing key
function getKey(header: any, callback: (err: Error | null, key: string | null) => void) {
    client.getSigningKey(header.kid, (err, key) => {
        if (err) {
            console.error('Error getting signing key:', err);
            callback(err, null); // Pass error to jwt.verify
        } else {
            const signingKey = key.getPublicKey();
            callback(null, signingKey);
        }
    });
}

// Authentication middleware
export const ensureAuthenticated = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    jwt.verify(token, getKey, {
        audience: process.env.AUTH0_AUDIENCE,
        issuer: `https://${process.env.AUTH0_DOMAIN}/`,
        algorithms: ['RS256']
    }, (err: Error | null, decoded: any) => {
        if (err) {
            console.error('Token verification error:', err);
            res.status(401).json({ error: 'Invalid token' });
        } else {
            req.user = decoded; // Attach decoded token payload to req.user
            next();
        }
    });
};