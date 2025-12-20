"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LANGUAGE_CONFIG = void 0;
exports.localizeProficiency = localizeProficiency;
exports.localizeLanguageName = localizeLanguageName;
exports.getLanguageConfig = getLanguageConfig;
exports.detectLanguage = detectLanguage;
exports.getLanguageInfo = getLanguageInfo;
exports.normalizeLanguageCode = normalizeLanguageCode;
const langdetect_1 = require("langdetect");
// Language configuration for resume sections
exports.LANGUAGE_CONFIG = {
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
function localizeProficiency(label, languageCode = 'en') {
    const config = getLanguageConfig(languageCode);
    const map = config.proficiencyMap || {};
    return map[label] || label;
}
function localizeLanguageName(name, languageCode = 'en') {
    const lower = (name || '').toLowerCase();
    const config = getLanguageConfig(languageCode);
    const names = config.languageNames || {};
    return names[lower] || name;
}
function getLanguageConfig(languageCode = 'en') {
    return exports.LANGUAGE_CONFIG[languageCode] || exports.LANGUAGE_CONFIG.en;
}
async function detectLanguage(text) {
    try {
        const detected = (0, langdetect_1.detect)(text);
        const langCode = Array.isArray(detected) && detected.length > 0 ? detected[0].lang : 'en';
        let language = 'English';
        let languageInstruction = '';
        if (langCode !== 'en' && langCode !== 'und') {
            const langs = (await Promise.resolve().then(() => __importStar(require('langs')))).default;
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
    }
    catch (error) {
        console.warn('Language detection failed, defaulting to English:', error);
        return {
            code: 'en',
            name: 'English',
            instruction: ''
        };
    }
}
function getLanguageInfo(languageCode = 'en') {
    const config = getLanguageConfig(languageCode);
    const langs = require('langs');
    const langObj = langs.where('1', languageCode);
    return {
        code: languageCode,
        name: (langObj === null || langObj === void 0 ? void 0 : langObj.name) || 'English',
        instruction: config.instruction
    };
}
const LANGUAGE_ALIASES = {
    en: 'en',
    english: 'en',
    'en-us': 'en',
    'en_gb': 'en',
    'en-gb': 'en',
    'en_uk': 'en',
    'en-uk': 'en',
    fr: 'fr',
    french: 'fr',
    francais: 'fr',
    'fr-fr': 'fr',
    'fr_fr': 'fr',
    es: 'es',
    spanish: 'es',
    espanol: 'es',
    castellano: 'es',
    'es-es': 'es',
    'es_es': 'es',
    de: 'de',
    german: 'de',
    deutsch: 'de',
    'de-de': 'de',
    'de_de': 'de',
};
function normalizeAliasKey(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/_/g, '-');
}
function normalizeLanguageCode(input) {
    if (!input || typeof input !== 'string') {
        return 'en';
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) {
        return 'en';
    }
    const normalized = normalizeAliasKey(trimmed);
    const asciiNormalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (exports.LANGUAGE_CONFIG[normalized]) {
        return normalized;
    }
    if (exports.LANGUAGE_CONFIG[asciiNormalized]) {
        return asciiNormalized;
    }
    if (LANGUAGE_ALIASES[normalized]) {
        return LANGUAGE_ALIASES[normalized];
    }
    if (LANGUAGE_ALIASES[asciiNormalized]) {
        return LANGUAGE_ALIASES[asciiNormalized];
    }
    const match = asciiNormalized.split('-')[0];
    if (exports.LANGUAGE_CONFIG[match]) {
        return match;
    }
    if (LANGUAGE_ALIASES[match]) {
        return LANGUAGE_ALIASES[match];
    }
    return 'en';
}
