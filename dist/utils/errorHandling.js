"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleValidationError = handleValidationError;
exports.handleDatabaseError = handleDatabaseError;
exports.handleUnauthorized = handleUnauthorized;
exports.handleNotFound = handleNotFound;
exports.handleGenericError = handleGenericError;
const zod_1 = require("zod");
function handleValidationError(error, res) {
    if (error instanceof zod_1.ZodError) {
        res.status(400).json({
            error: 'Invalid input',
            details: error.errors
        });
        return;
    }
    console.error('Validation error:', error);
    res.status(500).json({
        error: 'Validation failed'
    });
}
function handleDatabaseError(error, res, operation) {
    console.error(`Database error during ${operation}:`, error);
    res.status(500).json({
        error: `Failed to ${operation}`
    });
}
function handleUnauthorized(res) {
    res.status(401).json({ error: 'Unauthorized' });
}
function handleNotFound(res, resource) {
    res.status(404).json({ error: `${resource} not found` });
}
function handleGenericError(error, res, operation) {
    console.error(`Error during ${operation}:`, error);
    res.status(500).json({
        error: `Failed to ${operation}`
    });
}
