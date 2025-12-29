import { openai } from '../lib/openai';
import { getLanguageInfo } from './language';
import { protectPreservedTerms } from './preserveTerms';

export interface OpenAIOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
}

export interface TranslateTextOptions {
    /**
     * Terms to preserve exactly as-is (not translated). Useful for job-title keywords like "Data", "AI", "DevOps".
     * Matching is case-insensitive but the restored term uses the provided casing.
     */
    preserveTerms?: string[];
}

export async function callOpenAIWithRetry(
    prompt: string, 
    systemMessage: string = 'You are a helpful assistant.',
    options: OpenAIOptions = {}
): Promise<string | null> {
    const {
        model = 'gpt-5.2',
        temperature = 0.7,
        maxTokens = 500,
        maxRetries = 2
    } = options;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await openai.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: prompt },
                ],
                temperature: temperature + (attempt - 1) * 0.1, // Increase creativity on retries
                max_completion_tokens: maxTokens + (attempt - 1) * 100, // Increase token limit on retries
            });

            const content = response.choices[0]?.message?.content?.trim();
            if (content && content.length > 0) {
                return content;
            }
            console.warn(`Empty or invalid response on attempt ${attempt}`);
        } catch (apiError) {
            console.error(`OpenAI API error on attempt ${attempt}:`, apiError);
            if (attempt === maxRetries) {
                throw apiError; // Rethrow on final attempt
            }
        }
    }

    return null;
}

export async function enhanceWithOpenAI(
    prompt: string,
    systemMessage: string = 'You are a helpful assistant.',
    fallbackContent: string = '',
    options: OpenAIOptions = {}
): Promise<string> {
    try {
        const result = await callOpenAIWithRetry(prompt, systemMessage, options);
        return result || fallbackContent;
    } catch (error) {
        console.error('OpenAI enhancement failed:', error);
        return fallbackContent;
    }
} 

/**
 * Translate a given text to the target language using OpenAI.
 * Keeps technical terms and proper nouns when appropriate.
 */
export async function translateText(
    text: string,
    targetLanguageCode: string,
    options: TranslateTextOptions = {}
): Promise<string> {
    if (!text || text.trim().length === 0) return text;

    const preserveTerms = (options.preserveTerms || []).filter((t) => typeof t === 'string' && t.trim().length > 0);
    const protection = preserveTerms.length > 0 ? protectPreservedTerms(text, preserveTerms) : null;
    const textForModel = protection?.protectedText ?? text;

    const languageInfo = getLanguageInfo(targetLanguageCode);
    const targetName = languageInfo.name || 'French';
    const systemMessage = 'You are a professional translator. Return only the translated text.';
    const tokenInstruction = protection?.tokens?.length
        ? `\nDo not translate, remove, or modify these tokens: ${protection.tokens.join(', ')}. Keep them exactly as-is (including underscores).\n`
        : '\n';

    const prompt = `Translate the following text to ${targetName}. Keep technical terms and proper nouns as appropriate. Return only the translated text without quotes or additions.${tokenInstruction}

Text:
${textForModel}`;
    try {
        const result = await callOpenAIWithRetry(prompt, systemMessage, {
            model: 'gpt-5.2',
            temperature: 0.2,
            maxTokens: Math.min(Math.max(textForModel.length * 2, 200), 1200),
            maxRetries: 2,
        });

        const translated = (result || text).trim();
        return (protection ? protection.restore(translated) : translated).trim();
    } catch (e) {
        return text;
    }
}
