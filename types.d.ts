declare namespace Express {
    interface Request {
      user?: {
        sub: string;
        // Add other properties if your user object has more fields
      };
    }
  }