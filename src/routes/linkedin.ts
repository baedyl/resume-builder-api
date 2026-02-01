import express from 'express';
import axios from 'axios';
import { asyncHandler } from '../utils/asyncHandler';

const router = express.Router();

// POST /api/auth/linkedin/import
// Mounted at /api/auth/linkedin
router.post('/import', asyncHandler(async (req: any, res) => {
    const { code, redirectUri } = req.body;

    if (!code || !redirectUri) {
        return res.status(400).json({ error: 'Missing code or redirectUri' });
    }

    try {
        // 1. Exchange code for access token
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

        const accessToken = tokenResponse.data.access_token;

        // 2. Get User Info (OpenID Connect)
        const userInfoResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        // 3. Return profile data
        res.json(userInfoResponse.data);

    } catch (error: any) {
        console.error('LinkedIn Import Error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Failed to import LinkedIn profile',
            details: error.response?.data 
        });
    }
}));

export default router;
