import assert from 'node:assert/strict';
import { protectPreservedTerms } from '../utils/preserveTerms';

// Minimal sanity checks for preserved-term protection used by translateText()

{
    const { protectedText, tokens, restore } = protectPreservedTerms('Senior Data Consultant', ['Data']);
    assert.equal(protectedText, 'Senior __KEEP_TERM_0__ Consultant');
    assert.deepEqual(tokens, ['__KEEP_TERM_0__']);

    // Simulate translation reordering around the protected token
    assert.equal(restore('Consultant Senior __KEEP_TERM_0__'), 'Consultant Senior Data');
}

{
    // Ensure we match whole words only ("Data" should not affect "Database")
    const { protectedText, tokens } = protectPreservedTerms('Database Administrator', ['Data']);
    assert.equal(protectedText, 'Database Administrator');
    assert.deepEqual(tokens, []);
}

console.log('preserveTerms.selftest passed');

