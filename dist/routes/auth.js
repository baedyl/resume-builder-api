"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const asyncHandler_1 = require("../utils/asyncHandler");
const router = express_1.default.Router();
// POST /api/auth/linkedin/import
// Mounted at /api/auth
router.post('/linkedin/import', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    var _a, _b, _c;
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
            const tokenResponse = await axios_1.default.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
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
        const userInfoResponse = await axios_1.default.get('https://api.linkedin.com/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        console.log('LinkedIn user info fetched successfully');
        // 3. Return profile data
        res.json(userInfoResponse.data);
    }
    catch (error) {
        console.error('LinkedIn Import Error:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        const status = ((_b = error.response) === null || _b === void 0 ? void 0 : _b.status) || 500;
        const data = ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || {};
        res.status(status).json({
            error: 'Failed to import LinkedIn profile',
            details: data,
            message: error.message
        });
    }
}));
exports.default = router;
