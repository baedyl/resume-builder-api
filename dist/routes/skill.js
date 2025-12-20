"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const asyncHandler_1 = require("../utils/asyncHandler");
// Import shared utilities and services
const database_1 = require("../lib/database");
const errorHandling_1 = require("../utils/errorHandling");
const router = (0, express_1.Router)();
// GET /api/skills
router.get('/', (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    try {
        const skills = await database_1.prisma.skill.findMany();
        res.json(skills);
    }
    catch (error) {
        (0, errorHandling_1.handleDatabaseError)(error, res, 'fetch skills');
    }
}));
exports.default = router;
