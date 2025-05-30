import { Request, Response, NextFunction } from 'express';
import jwt, { GetPublicKeyOrSecret } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

// Ensure environment variables are set at startup
if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
    throw new Error('AUTH0_DOMAIN and AUTH0_AUDIENCE must be set in environment variables');
}

// Initialize JWKS client
const client = jwksClient({
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

// Define a custom Request interface to include the user property
interface CustomRequest extends Request {
    headers?: any;
}

// Function to retrieve the signing key
const getKey: GetPublicKeyOrSecret = (header, callback) => {
    client.getSigningKey(header.kid, (err, key) => {
        if (err || !key) {
            console.error('Error getting signing key:', err);
            callback(new Error('Signing key not found'), undefined);
        } else {
            const signingKey = key.getPublicKey();
            callback(null, signingKey);
        }
    });
};

// Authentication middleware
export const ensureAuthenticated = (
    req: CustomRequest,
    res: Response,
    next: NextFunction
): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(
        token,
        getKey,
        {
            audience: process.env.AUTH0_AUDIENCE,
            issuer: `https://${process.env.AUTH0_DOMAIN}/`,
            algorithms: ['RS256'],
        },
        (err: Error | null, decoded: any) => {
            if (err) {
                console.error('Token verification error:', err);
                res.status(401).json({ error: 'Invalid token' });
            } else {
                // Assert decoded as the expected type
                req.user = decoded as { sub: string };
                next();
            }
        }
    );
};