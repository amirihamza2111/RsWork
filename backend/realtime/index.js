// Supabase Realtime Broadcast publisher with the same call shape the
// controllers used with Socket.IO: getIO().to(room).emit(event, payload).
//
// Room -> topic mapping:
//   restaurant_<id> -> restaurant:<id>  private (RLS: staff of that restaurant)
//   waiter_<id>     -> waiter:<id>      private (RLS: that waiter only)
//   table_<id>      -> table:<id>       public  (anonymous diners) — slim, PII-free payloads
const config = require('../config');

const ENDPOINT = `${config.supabase.url}/realtime/v1/api/broadcast`;
const key = config.supabase.serviceRoleKey;
const headers = {
  'Content-Type': 'application/json',
  apikey: key,
  // Legacy service_role keys are JWTs; the newer sb_secret_ keys go in apikey only.
  ...(String(key).startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
};

const toTopic = (room) => {
  const match = /^(restaurant|waiter|table)_(.+)$/.exec(String(room));
  if (!match) return null;
  return { topic: `${match[1]}:${match[2]}`, isPrivate: match[1] !== 'table' };
};

// Diners only refetch on these events, so the public channel never carries
// customer or staff identity.
const slimForPublic = (payload = {}) => ({
  orderId: payload.order?._id ?? payload.orderId ?? null,
  orderNumber: payload.order?.orderNumber ?? payload.orderNumber ?? null,
  status: payload.order?.status ?? payload.status ?? null,
});

let queue = [];
let scheduled = false;

const flush = async () => {
  scheduled = false;
  const messages = queue;
  queue = [];
  if (messages.length === 0) return;
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages }),
    });
    if (!resp.ok) {
      console.warn(`[realtime] broadcast failed: ${resp.status} ${await resp.text()}`);
    }
  } catch (err) {
    console.warn(`[realtime] broadcast error: ${err.message}`);
  }
};

const publish = (room, event, payload) => {
  const target = toTopic(room);
  if (!target) return;
  const body = target.isPrivate ? payload : slimForPublic(payload);
  queue.push({
    topic: target.topic,
    event,
    payload: JSON.parse(JSON.stringify(body ?? {})),
    private: target.isPrivate,
  });
  // Batch every emit made during the same tick into one HTTP request.
  if (!scheduled) {
    scheduled = true;
    setImmediate(flush);
  }
};

const io = {
  to: (room) => ({ emit: (event, payload) => publish(room, event, payload) }),
};

module.exports = { getIO: () => io, flush };
