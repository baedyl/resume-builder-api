import { detect } from 'langdetect';

export interface LanguageInfo {
    code: string;
    name: string;
    instruction: string;
}

export async function detectLanguage(text: string): Promise<LanguageInfo> {
    try {
        const detected = detect(text);
        const langCode = Array.isArray(detected) && detected.length > 0 ? detected[0].lang : 'en';
        
        let language = 'English';
        let languageInstruction = '';
        
        if (langCode !== 'en' && langCode !== 'und') {
            const langs = (await import('langs')).default;
            const langObj = langs.where('1', langCode);
            if (langObj && langObj.name) {
                language = langObj.name;
                languageInstruction = `IMPORTANT: The provided text is in ${language}. You must return all content in ${language}. Keep technical terms and proper nouns as appropriate.`;
            }
        }
        
        return {
            code: langCode,
            name: language,
            instruction: languageInstruction
        };
    } catch (error) {
        console.warn('Language detection failed, defaulting to English:', error);
        return {
            code: 'en',
            name: 'English',
            instruction: ''
        };
    }
} 