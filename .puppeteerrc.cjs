const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Use local cache in production (Render) to ensure persistence, 
  // but use default global cache locally to avoid breaking existing setups.
  cacheDirectory: process.env.RENDER || process.env.NODE_ENV === 'production'
    ? join(__dirname, '.cache', 'puppeteer') 
    : undefined,
};
