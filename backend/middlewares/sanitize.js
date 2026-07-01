// Removes MongoDB operator keys (starting with "$" or containing ".") from the
// request body and params, neutralising NoSQL operator injection. Query strings
// are handled separately by the "simple" query parser in app.js (which does not
// build nested objects from bracket notation).
const stripKeys = (value, depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((item) => stripKeys(item, depth + 1));
    return;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete value[key];
      continue;
    }
    stripKeys(value[key], depth + 1);
  }
};

const sanitizeRequest = (req, res, next) => {
  stripKeys(req.body);
  stripKeys(req.params);
  next();
};

module.exports = { sanitizeRequest, stripKeys };
