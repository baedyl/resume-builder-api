"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEEP_TOKEN_PREFIX = void 0;
exports.protectPreservedTerms = protectPreservedTerms;
exports.KEEP_TOKEN_PREFIX = '__KEEP_TERM_';
function escapeRegExp(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Replaces whole-word occurrences of the provided terms with stable tokens so an LLM translator won't translate them.
 *
 * Example: "Senior Data Consultant" with ["Data"] becomes "Senior __KEEP_TERM_0__ Consultant".
 */
function protectPreservedTerms(text, preserveTerms) {
    const tokens = [];
    const replacements = [];
    let protectedText = text;
    for (let i = 0; i < preserveTerms.length; i++) {
        const term = preserveTerms[i];
        if (!term || typeof term !== 'string')
            continue;
        const trimmed = term.trim();
        if (!trimmed)
            continue;
        const token = `${exports.KEEP_TOKEN_PREFIX}${i}__`;
        const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'gi');
        const next = protectedText.replace(re, token);
        if (next !== protectedText) {
            protectedText = next;
            tokens.push(token);
            replacements.push({ token, term: trimmed });
        }
    }
    const restore = (translated) => {
        let out = translated;
        for (const { token, term } of replacements) {
            out = out.split(token).join(term);
        }
        return out;
    };
    return { protectedText, tokens, restore };
}
