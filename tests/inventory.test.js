const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let calls = [];
let product = null;
const client = {
  async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT * FROM products')) return { rows: product ? [{ ...product }] : [] };
    return { rows: [] };
  },
  release() { calls.push({ sql: 'RELEASE' }); },
};

const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getClient: async () => client, query: async () => ({ rows: [] }) },
};

const { submitReport, postInventoryReport } = require('../src/controllers/posController');

function request(body) {
  return { body, session: { user: { id: 7 } } };
}

function response() {
  return { redirectPath: null, redirect(path) { this.redirectPath = path; } };
}

beforeEach(() => {
  calls = [];
  product = { id: 2, name: 'Rice', stock_quantity: 10 };
});

test('inventory reports lock stock, update it, and record before/after quantities atomically', async () => {
  await submitReport(2, 'restock', 5, 'Supplier delivery', 7);

  assert.deepEqual(calls.map(call => call.sql), [
    'BEGIN',
    'SELECT * FROM products WHERE id = $1 FOR UPDATE',
    'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
    'INSERT INTO inventory_reports (user_id, product_id, type, quantity_change, note, previous_stock, new_stock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    'COMMIT',
    'RELEASE',
  ]);
  assert.deepEqual(calls[2].params, [15, 2]);
  assert.deepEqual(calls[3].params, [7, 2, 'restock', 5, 'Supplier delivery', 10, 15]);
});

test('inventory reports roll back instead of allowing negative stock', async () => {
  await assert.rejects(() => submitReport(2, 'lost', -11, 'Missing items', 7), /below zero stock/);

  assert(calls.some(call => call.sql === 'ROLLBACK'));
  assert(!calls.some(call => call.sql.startsWith('UPDATE products')));
  assert(!calls.some(call => call.sql.startsWith('INSERT INTO inventory_reports')));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('inventory reports roll back when the product no longer exists', async () => {
  product = null;
  await assert.rejects(() => submitReport(99, 'restock', 1, '', 7), /Product not found/);
  assert(calls.some(call => call.sql === 'ROLLBACK'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('inventory form assigns the correct sign for every adjustment type', async () => {
  const cases = [
    [{ product_id: '2', type: 'restock', quantity: '3', note: 'Delivery' }, 13],
    [{ product_id: '2', type: 'damaged', quantity: '3', note: 'Wet' }, 7],
    [{ product_id: '2', type: 'lost', quantity: '3', note: 'Missing' }, 7],
    [{ product_id: '2', type: 'correction', direction: 'increase', quantity: '3', note: 'Counted again' }, 13],
    [{ product_id: '2', type: 'correction', direction: 'decrease', quantity: '3', note: 'Counted again' }, 7],
  ];

  for (const [body, expectedStock] of cases) {
    calls = [];
    const req = request(body);
    const res = response();
    await postInventoryReport(req, res);
    assert.equal(res.redirectPath, '/pos/inventory');
    assert.equal(req.session.flash.error, undefined);
    assert.equal(calls.find(call => call.sql.startsWith('UPDATE products')).params[0], expectedStock);
  }
});

test('inventory form rejects invalid input before opening a transaction', async () => {
  const invalidBodies = [
    { product_id: 'none', type: 'restock', quantity: '1' },
    { product_id: '2', type: 'restock', quantity: '1.5' },
    { product_id: '2', type: 'unknown', quantity: '1' },
    { product_id: '2', type: 'correction', direction: 'increase', quantity: '1', note: ' ' },
    { product_id: '2', type: 'correction', direction: 'sideways', quantity: '1', note: 'Count' },
  ];

  for (const body of invalidBodies) {
    calls = [];
    const req = request(body);
    const res = response();
    await postInventoryReport(req, res);
    assert.equal(res.redirectPath, '/pos/inventory');
    assert(req.session.flash.error);
    assert.equal(calls.length, 0);
  }
});
