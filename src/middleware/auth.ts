import { Request, Response, NextFunction } from 'express';
import jwt, { GetPublicKeyOrSecret } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import axios from 'axios';

// Ensure environment variables are set at startup
if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
    throw new Error('AUTH0_DOMAIN and AUTH0_AUDIENCE must be set in environment variables');
}

// Initialize JWKS client
const client = jwksClient({
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
});

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

// Function to fetch user info from Auth0
async function fetchUserInfo(accessToken: string): Promise<any> {
    try {
        const response = await axios.get(`https://${process.env.AUTH0_DOMAIN}/userinfo`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching user info from Auth0:', error);
        return null;
    }
}

// Authentication middleware
export const ensureAuthenticated = (
    req: any,
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
        async (err: Error | null, decoded: any) => {
            if (err) {
                console.error('Token verification error:', err);
                res.status(401).json({ error: 'Invalid token' });
            } else {
                // Extract user information from JWT token
                console.log('JWT decoded payload:', JSON.stringify(decoded, null, 2));
                
                // Try multiple possible email fields in Auth0 JWT
                let email = decoded.email || 
                           decoded['https://dev-v3pu2a2b.us.auth0.com/email'] ||
                           decoded['https://dev-v3pu2a2b.us.auth0.com/user/email'] ||
                           decoded['https://dev-v3pu2a2b.us.auth0.com/userinfo/email'] ||
                           decoded['email_verified'] ? decoded.email : undefined;
                
                // Log all possible email fields for debugging
                console.log('Email extraction debug:', {
                    'decoded.email': decoded.email,
                    'decoded.email_verified': decoded.email_verified,
                    'decoded.https://dev-v3pu2a2b.us.auth0.com/email': decoded['https://dev-v3pu2a2b.us.auth0.com/email'],
                    'decoded.https://dev-v3pu2a2b.us.auth0.com/user/email': decoded['https://dev-v3pu2a2b.us.auth0.com/user/email'],
                    'decoded.https://dev-v3pu2a2b.us.auth0.com/userinfo/email': decoded['https://dev-v3pu2a2b.us.auth0.com/userinfo/email'],
                    'final_email': email
                });
                
                // If email is not in JWT, try to fetch from Auth0 userinfo endpoint
                if (!email) {
                    console.log('Email not found in JWT, fetching from Auth0 userinfo endpoint...');
                    try {
                        const userInfo = await fetchUserInfo(token);
                        if (userInfo && userInfo.email) {
                            email = userInfo.email;
                            console.log('Email fetched from userinfo:', email);
                        } else {
                            console.log('No email found in userinfo response:', userInfo);
                        }
                    } catch (error) {
                        console.error('Failed to fetch userinfo:', error);
                        // Continue without email - it will be handled in the route
                    }
                }
                
                req.user = {
                    sub: decoded.sub,
                    email: email
                } as { sub: string; email?: string };
                console.log('Extracted user info:', req.user);
                next();
            }
        }
    );
};