const test = require('node:test');
const assert = require('node:assert');
const { sanitizeText } = require('../../utils/sanitizeText');
const { stripKeys } = require('../../middlewares/sanitize');
const { redactOrderForPublic } = require('../../utils/orderView');

test('sanitizeText: strips HTML tags and caps length', () => {
  assert.equal(sanitizeText('<script>alert(1)</script>hello'), 'alert(1)hello');
  assert.equal(sanitizeText('<img src=x onerror=alert(1)>'), '');
  assert.equal(sanitizeText('  spaced  '), 'spaced');
  assert.equal(sanitizeText('abcdef', 3), 'abc');
  assert.equal(sanitizeText(undefined), undefined);
  assert.equal(sanitizeText(null), null);
});

test('stripKeys: removes $-prefixed and dotted keys (NoSQL operators), recursively', () => {
  const body = { email: { $gt: '' }, name: 'ok', nested: { 'a.b': 1, keep: 2 } };
  stripKeys(body);
  assert.deepEqual(body.email, {}); // $gt removed
  assert.equal(body.name, 'ok');
  assert.equal(body.nested.keep, 2);
  assert.ok(!('a.b' in body.nested));
});

test('stripKeys: handles arrays without throwing', () => {
  const body = { items: [{ $where: 'x', menuItem: 'abc' }] };
  stripKeys(body);
  assert.equal(body.items[0].menuItem, 'abc');
  assert.ok(!('$where' in body.items[0]));
});

test('redactOrderForPublic: removes client and waiter (PII), keeps the rest', () => {
  const order = {
    toObject() {
      return {
        _id: 'o1',
        status: 'ready',
        client: { name: 'A', email: 'a@a.com', phone: '123' },
        waiter: { name: 'W' },
        items: [{ menuItem: 'm1' }],
        totalAmount: 40,
      };
    },
  };
  const view = redactOrderForPublic(order);
  assert.ok(!('client' in view));
  assert.ok(!('waiter' in view));
  assert.equal(view.status, 'ready');
  assert.equal(view.totalAmount, 40);
  assert.deepEqual(view.items, [{ menuItem: 'm1' }]);
});
