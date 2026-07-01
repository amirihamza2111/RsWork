// Redacted order view for unauthenticated / unauthorized callers (public order
// tracking). Removes customer and staff identity so order ids can't be used to
// harvest PII (IDOR / excessive data exposure).
const redactOrderForPublic = (order) => {
  const obj = order && typeof order.toObject === 'function' ? order.toObject() : { ...order };
  delete obj.client;
  delete obj.waiter;
  return obj;
};

module.exports = { redactOrderForPublic };
