import express from 'express';
import axios from 'axios';
import { asyncHandler } from '../utils/asyncHandler';

const router = express.Router();

// POST /api/auth/linkedin/import
// Mounted at /api/auth
router.post('/linkedin/import', asyncHandler(async (req: any, res) => {
    const { code, redirectUri, accessToken: providedAccessToken } = req.body;

    console.log('Received LinkedIn import request:', { 
        hasCode: !!code, 
        redirectUri,
        hasAccessToken: !!providedAccessToken 
    });

    if (!providedAccessToken && (!code || !redirectUri)) {
        return res.status(400).json({ error: 'Missing code and redirectUri, or accessToken' });
    }

    if (!providedAccessToken && (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET)) {
        console.error('LinkedIn credentials missing in environment variables');
        return res.status(500).json({ error: 'Server configuration error: LinkedIn credentials missing' });
    }

    try {
        let accessToken = providedAccessToken;

        if (!accessToken) {
            // 1. Exchange code for access token
            console.log(`Exchanging LinkedIn code for token. ClientID: ${process.env.LINKEDIN_CLIENT_ID}, RedirectURI: ${redirectUri}`);
            const tokenResponse = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
                params: {
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: redirectUri,
                    client_id: process.env.LINKEDIN_CLIENT_ID,
                    client_secret: process.env.LINKEDIN_CLIENT_SECRET
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            console.log('LinkedIn token exchange successful');
            accessToken = tokenResponse.data.access_token;
        }

        // 2. Get User Info (OpenID Connect)
        console.log('Fetching LinkedIn user info...');
        const userInfoResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        console.log('LinkedIn user info fetched successfully');

        // 3. Return profile data
        res.json(userInfoResponse.data);

    } catch (error: any) {
        console.error('LinkedIn Import Error:', error.response?.data || error.message);
        
        const status = error.response?.status || 500;
        const data = error.response?.data || {};
        
        res.status(status).json({ 
            error: 'Failed to import LinkedIn profile',
            details: data,
            message: error.message
        });
    }
}));

export default router;
