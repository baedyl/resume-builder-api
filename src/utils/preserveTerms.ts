export const KEEP_TOKEN_PREFIX = '__KEEP_TERM_';

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces whole-word occurrences of the provided terms with stable tokens so an LLM translator won't translate them.
 *
 * Example: "Senior Data Consultant" with ["Data"] becomes "Senior __KEEP_TERM_0__ Consultant".
 */
export function protectPreservedTerms(text: string, preserveTerms: string[]): {
    protectedText: string;
    tokens: string[];
    restore: (translated: string) => string;
} {
    const tokens: string[] = [];
    const replacements: Array<{ token: string; term: string }> = [];

    let protectedText = text;
    for (let i = 0; i < preserveTerms.length; i++) {
        const term = preserveTerms[i];
        if (!term || typeof term !== 'string') continue;
        const trimmed = term.trim();
        if (!trimmed) continue;

        const token = `${KEEP_TOKEN_PREFIX}${i}__`;
        const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'gi');
        const next = protectedText.replace(re, token);
        if (next !== protectedText) {
            protectedText = next;
            tokens.push(token);
            replacements.push({ token, term: trimmed });
        }
    }

    const restore = (translated: string): string => {
        let out = translated;
        for (const { token, term } of replacements) {
            out = out.split(token).join(term);
        }
        return out;
    };

    return { protectedText, tokens, restore };
}

