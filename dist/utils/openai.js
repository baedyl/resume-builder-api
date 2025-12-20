"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callOpenAIWithRetry = callOpenAIWithRetry;
exports.enhanceWithOpenAI = enhanceWithOpenAI;
exports.translateText = translateText;
const openai_1 = require("../lib/openai");
const language_1 = require("./language");
async function callOpenAIWithRetry(prompt, systemMessage = 'You are a helpful assistant.', options = {}) {
    var _a, _b, _c;
    const { model = 'gpt-3.5-turbo', temperature = 0.7, maxTokens = 500, maxRetries = 2 } = options;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await openai_1.openai.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: prompt },
                ],
                temperature: temperature + (attempt - 1) * 0.1, // Increase creativity on retries
                max_tokens: maxTokens + (attempt - 1) * 100, // Increase token limit on retries
            });
            const content = (_c = (_b = (_a = response.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.trim();
            if (content && content.length > 0) {
                return content;
            }
            console.warn(`Empty or invalid response on attempt ${attempt}`);
        }
        catch (apiError) {
            console.error(`OpenAI API error on attempt ${attempt}:`, apiError);
            if (attempt === maxRetries) {
                throw apiError; // Rethrow on final attempt
            }
        }
    }
    return null;
}
async function enhanceWithOpenAI(prompt, systemMessage = 'You are a helpful assistant.', fallbackContent = '', options = {}) {
    try {
        const result = await callOpenAIWithRetry(prompt, systemMessage, options);
        return result || fallbackContent;
    }
    catch (error) {
        console.error('OpenAI enhancement failed:', error);
        return fallbackContent;
    }
}
/**
 * Translate a given text to the target language using OpenAI.
 * Keeps technical terms and proper nouns when appropriate.
 */
async function translateText(text, targetLanguageCode) {
    if (!text || text.trim().length === 0)
        return text;
    const languageInfo = (0, language_1.getLanguageInfo)(targetLanguageCode);
    const targetName = languageInfo.name || 'French';
    const systemMessage = 'You are a professional translator. Return only the translated text.';
    const prompt = `Translate the following text to ${targetName}. Keep technical terms and proper nouns as appropriate. Return only the translated text without quotes or additions.

Text:
${text}`;
    try {
        const result = await callOpenAIWithRetry(prompt, systemMessage, {
            model: 'gpt-3.5-turbo',
            temperature: 0.2,
            maxTokens: Math.min(Math.max(text.length * 2, 200), 1200),
            maxRetries: 2,
        });
        return (result || text).trim();
    }
    catch (e) {
        return text;
    }
}
