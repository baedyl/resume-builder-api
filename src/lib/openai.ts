import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
}

export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export default openai; 