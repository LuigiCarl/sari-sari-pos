const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toCentavos, fromCentavos } = require('../src/utils/money');

let existingId;
let stock;
let calls;
const client = {
  async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id FROM sales')) return { rows: existingId ? [{ id: existingId }] : [] };
    if (sql.startsWith('SELECT * FROM products')) return { rows: [{ id: params[0], name: 'Water', selling_price: 0.10, stock_quantity: stock, unit: 'pc' }] };
    if (sql.startsWith('INSERT INTO sales')) return { rows: [{ id: 42 }] };
    return { rows: [] };
  },
  release() {},
};
const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getClient: async () => client } };
const { postCheckout } = require('../src/controllers/posController');
const token = '11111111-1111-4111-8111-111111111111';

async function run(items, paid = '0.30', checkoutToken = token) {
  const req = { body: { items: JSON.stringify(items), amount_paid: paid, checkout_token: checkoutToken }, session: { user: { id: 7 } } };
  let redirect;
  await postCheckout(req, { redirect: path => { redirect = path; } });
  return { redirect, flash: req.session.flash };
}

test('money is exact and rejects invalid precision', () => {
  assert.equal(toCentavos('0.10') * 3, 30);
  assert.equal(fromCentavos(30), '0.30');
  for (const value of ['NaN', '', '-1', '1.001', 'Infinity']) assert.throws(() => toCentavos(value));
});

test('checkout combines products and writes exact totals', async () => {
  existingId = null; stock = 5; calls = [];
  const result = await run([{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }]);
  assert.equal(result.redirect, '/pos/receipt/42');
  const sale = calls.find(c => c.sql.startsWith('INSERT INTO sales'));
  assert.deepEqual(sale.params.slice(2), ['0.30', '0.30', '0.00', token]);
  assert.equal(calls.filter(c => c.sql.startsWith('INSERT INTO sale_items')).length, 1);
  assert.deepEqual(calls.find(c => c.sql.startsWith('UPDATE products')).params, [2, 1]);
});

test('combined quantities cannot oversell stock', async () => {
  existingId = null; stock = 2; calls = [];
  const result = await run([{ productId: 1, quantity: 2 }, { productId: 1, quantity: 1 }]);
  assert.equal(result.redirect, '/pos');
  assert.match(result.flash.error, /Not enough stock/);
  assert(calls.some(c => c.sql === 'ROLLBACK'));
  assert(!calls.some(c => c.sql.startsWith('INSERT')));
});

test('retry returns existing receipt without stock changes', async () => {
  existingId = 42; stock = 0; calls = [];
  const result = await run([{ productId: 1, quantity: 3 }]);
  assert.equal(result.redirect, '/pos/receipt/42');
  assert(calls.some(c => c.sql.includes('pg_advisory_xact_lock')));
  assert(!calls.some(c => c.sql.startsWith('UPDATE') || c.sql.startsWith('INSERT')));
});

test('invalid payment and token are rejected before database writes', async () => {
  existingId = null; calls = [];
  assert.equal((await run([{ productId: 1, quantity: 1 }], '0.001')).redirect, '/pos');
  assert.equal((await run([{ productId: 1, quantity: 1 }], '1', '')).redirect, '/pos');
  assert.equal(calls.length, 0);
});
