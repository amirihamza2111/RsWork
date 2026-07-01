// Strips HTML tags from free-text input and caps length, as defense-in-depth
// against stored XSS (the frontend should still encode on output).
const sanitizeText = (value, maxLen = 1000) => {
  if (value === undefined || value === null) return value;
  return String(value)
    .replace(/<[^>]*>/g, '') // remove HTML tags
    .trim()
    .slice(0, maxLen);
};

module.exports = { sanitizeText };
