// src/types/express/index.d.ts
import * as core from 'express-serve-static-core';

declare global {
  namespace Express {
    // Merge with the core Request so .body and .headers exist
    interface Request extends core.Request {
      // add your own field from ensureAuthenticated
      user?: { 
        sub: string; 
        email?: string;
        isPremium?: boolean;
      };
    }
  }
}
