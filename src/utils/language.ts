import { detect } from 'langdetect';

export interface LanguageInfo {
    code: string;
    name: string;
    instruction: string;
}

// Language configuration for resume sections
export const LANGUAGE_CONFIG = {
    en: {
        sections: {
            professionalSummary: 'PROFESSIONAL SUMMARY',
            skills: 'SKILLS',
            professionalExperience: 'PROFESSIONAL EXPERIENCE',
            education: 'EDUCATION',
            certifications: 'CERTIFICATIONS',
            languages: 'LANGUAGES'
        },
        labels: {
            tech: 'Tech'
        },
        proficiencyMap: {
            Beginner: 'Beginner',
            Elementary: 'Elementary',
            Intermediate: 'Intermediate',
            Advanced: 'Advanced',
            Native: 'Native',
            Fluent: 'Fluent'
        },
        languageNames: {
            english: 'English', french: 'French', spanish: 'Spanish', german: 'German',
            chinese: 'Chinese', arabic: 'Arabic', portuguese: 'Portuguese', italian: 'Italian',
            dutch: 'Dutch', japanese: 'Japanese', korean: 'Korean', russian: 'Russian'
        },
        systemMessage: 'You are an expert resume writer. Return only valid JSON.',
        instruction: ''
    },
    fr: {
        sections: {
            professionalSummary: 'RÉSUMÉ PROFESSIONNEL',
            skills: 'COMPÉTENCES',
            professionalExperience: 'EXPÉRIENCE PROFESSIONNELLE',
            education: 'FORMATION',
            certifications: 'CERTIFICATIONS',
            languages: 'LANGUES'
        },
        labels: {
            tech: 'Technologie'
        },
        proficiencyMap: {
            Beginner: 'Débutant',
            Elementary: 'Élémentaire',
            Intermediate: 'Intermédiaire',
            Advanced: 'Avancé',
            Native: 'Natif',
            Fluent: 'Courant'
        },
        languageNames: {
            english: 'Anglais', french: 'Français', spanish: 'Espagnol', german: 'Allemand',
            chinese: 'Chinois', arabic: 'Arabe', portuguese: 'Portugais', italian: 'Italien',
            dutch: 'Néerlandais', japanese: 'Japonais', korean: 'Coréen', russian: 'Russe'
        },
        systemMessage: 'Vous êtes un expert en rédaction de CV. Retournez uniquement du JSON valide.',
        instruction: 'IMPORTANT: The provided text is in French. You must return all content in French. Keep technical terms and proper nouns as appropriate.'
    },
    es: {
        sections: {
            professionalSummary: 'RESUMEN PROFESIONAL',
            skills: 'HABILIDADES',
            professionalExperience: 'EXPERIENCIA PROFESIONAL',
            education: 'EDUCACIÓN',
            certifications: 'CERTIFICACIONES',
            languages: 'IDIOMAS'
        },
        labels: {
            tech: 'Tecnología'
        },
        proficiencyMap: {
            Beginner: 'Principiante',
            Elementary: 'Elemental',
            Intermediate: 'Intermedio',
            Advanced: 'Avanzado',
            Native: 'Nativo',
            Fluent: 'Fluido'
        },
        languageNames: {
            english: 'Inglés', french: 'Francés', spanish: 'Español', german: 'Alemán',
            chinese: 'Chino', arabic: 'Árabe', portuguese: 'Portugués', italian: 'Italiano',
            dutch: 'Neerlandés', japanese: 'Japonés', korean: 'Coreano', russian: 'Ruso'
        },
        systemMessage: 'Eres un experto en redacción de currículums. Devuelve solo JSON válido.',
        instruction: 'IMPORTANT: The provided text is in Spanish. You must return all content in Spanish. Keep technical terms and proper nouns as appropriate.'
    },
    de: {
        sections: {
            professionalSummary: 'BERUFLICHE ZUSAMMENFASSUNG',
            skills: 'FÄHIGKEITEN',
            professionalExperience: 'BERUFSERFAHRUNG',
            education: 'AUSBILDUNG',
            certifications: 'ZERTIFIZIERUNGEN',
            languages: 'SPRACHEN'
        },
        labels: {
            tech: 'Technologie'
        },
        proficiencyMap: {
            Beginner: 'Anfänger',
            Elementary: 'Elementar',
            Intermediate: 'Mittelstufe',
            Advanced: 'Fortgeschritten',
            Native: 'Muttersprachler',
            Fluent: 'Fließend'
        },
        languageNames: {
            english: 'Englisch', french: 'Französisch', spanish: 'Spanisch', german: 'Deutsch',
            chinese: 'Chinesisch', arabic: 'Arabisch', portuguese: 'Portugiesisch', italian: 'Italienisch',
            dutch: 'Niederländisch', japanese: 'Japanisch', korean: 'Koreanisch', russian: 'Russisch'
        },
        systemMessage: 'Sie sind ein Experte für Lebenslauf-Erstellung. Geben Sie nur gültiges JSON zurück.',
        instruction: 'IMPORTANT: The provided text is in German. You must return all content in German. Keep technical terms and proper nouns as appropriate.'
    }
};

export function localizeProficiency(label: string, languageCode: string = 'en'): string {
    const config = getLanguageConfig(languageCode);
    const map = (config as any).proficiencyMap || {};
    return map[label] || label;
}

export function localizeLanguageName(name: string, languageCode: string = 'en'): string {
    const lower = (name || '').toLowerCase();
    const config = getLanguageConfig(languageCode) as any;
    const names = config.languageNames || {};
    return names[lower] || name;
}

export function getLanguageConfig(languageCode: string = 'en') {
    return LANGUAGE_CONFIG[languageCode as keyof typeof LANGUAGE_CONFIG] || LANGUAGE_CONFIG.en;
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

export function getLanguageInfo(languageCode: string = 'en'): LanguageInfo {
    const config = getLanguageConfig(languageCode);
    const langs = require('langs');
    const langObj = langs.where('1', languageCode);
    
    return {
        code: languageCode,
        name: langObj?.name || 'English',
        instruction: config.instruction
    };
} 