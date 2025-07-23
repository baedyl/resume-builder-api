import { Response } from 'express';
import { ZodError } from 'zod';

export function handleValidationError(error: unknown, res: Response): void {
    if (error instanceof ZodError) {
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

export function handleDatabaseError(error: unknown, res: Response, operation: string): void {
    console.error(`Database error during ${operation}:`, error);
    res.status(500).json({ 
        error: `Failed to ${operation}` 
    });
}

export function handleUnauthorized(res: Response): void {
    res.status(401).json({ error: 'Unauthorized' });
}

export function handleNotFound(res: Response, resource: string): void {
    res.status(404).json({ error: `${resource} not found` });
}

export function handleGenericError(error: unknown, res: Response, operation: string): void {
    console.error(`Error during ${operation}:`, error);
    res.status(500).json({ 
        error: `Failed to ${operation}` 
    });
} 