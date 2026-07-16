// Dining-session validity checks (table QR sessions).

// A session is active when it has an id and hasn't expired.
const isSessionActive = (session, now = Date.now()) =>
  Boolean(session?.id && session.expiresAt && new Date(session.expiresAt).getTime() > now);

// A diner-supplied sessionId authorizes an order only when it matches the
// table's active session exactly.
const isValidOrderSession = (session, sessionId, now = Date.now()) =>
  isSessionActive(session, now) && Boolean(sessionId) && sessionId === session.id;

module.exports = { isSessionActive, isValidOrderSession };
