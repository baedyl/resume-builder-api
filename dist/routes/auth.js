"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAuthenticated = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwks_rsa_1 = __importDefault(require("jwks-rsa"));
// JWKS client setup
const client = (0, jwks_rsa_1.default)({
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
});
// Get signing key
const getKey = (header, callback) => {
    client.getSigningKey(header.kid, (err, key) => {
        if (err || !key) {
            callback(new Error('Signing key not found'), undefined);
        }
        else {
            const signingKey = key.getPublicKey();
            callback(null, signingKey);
        }
    });
};
// Middleware
const ensureAuthenticated = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const token = authHeader.split(' ')[1];
    jsonwebtoken_1.default.verify(token, getKey, {
        audience: process.env.AUTH0_AUDIENCE,
        issuer: `https://${process.env.AUTH0_DOMAIN}/`,
        algorithms: ['RS256']
    }, (err, decoded) => {
        if (err) {
            res.status(401).json({ error: 'Invalid token' });
        }
        else {
            req.user = decoded;
            next();
        }
    });
};
exports.ensureAuthenticated = ensureAuthenticated;
