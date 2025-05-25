import { OpenAI } from 'openai';

export function getOpenAIClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('OPENAI_API_KEY is not defined in .env.local');
        return null;
    }
    try {
        return new OpenAI({ apiKey });
    } catch (error) {
        console.error('Failed to initialize OpenAI client:', error);
        return null;
    }
}