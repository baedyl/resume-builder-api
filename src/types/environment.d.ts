declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string;
      OPENAI_API_KEY: string;
      OPENAI_ASSISTANT_ID: string;
      STRIPE_SECRET_KEY: string;
      STRIPE_PUBLISHABLE_KEY: string;
      STRIPE_WEBHOOK_SECRET: string;
      STRIPE_PRICE_ID_PREMIUM: string;
      FRONTEND_URL: string;
      AUTH0_DOMAIN: string;
      AUTH0_AUDIENCE: string;
      NODE_ENV: 'development' | 'production' | 'test';
    }
  }
}

export {}; 