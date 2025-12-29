"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const preserveTerms_1 = require("../utils/preserveTerms");
// Minimal sanity checks for preserved-term protection used by translateText()
{
    const { protectedText, tokens, restore } = (0, preserveTerms_1.protectPreservedTerms)('Senior Data Consultant', ['Data']);
    strict_1.default.equal(protectedText, 'Senior __KEEP_TERM_0__ Consultant');
    strict_1.default.deepEqual(tokens, ['__KEEP_TERM_0__']);
    // Simulate translation reordering around the protected token
    strict_1.default.equal(restore('Consultant Senior __KEEP_TERM_0__'), 'Consultant Senior Data');
}
{
    // Ensure we match whole words only ("Data" should not affect "Database")
    const { protectedText, tokens } = (0, preserveTerms_1.protectPreservedTerms)('Database Administrator', ['Data']);
    strict_1.default.equal(protectedText, 'Database Administrator');
    strict_1.default.deepEqual(tokens, []);
}
console.log('preserveTerms.selftest passed');
