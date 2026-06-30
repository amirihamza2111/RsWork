// Standard success envelope so every JSON endpoint responds with the same shape:
// { success: true, message, data }.
const ok = (res, data = null, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

const created = (res, data = null, message = 'Created') => ok(res, data, message, 201);

module.exports = { ok, created };
