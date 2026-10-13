const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { productValues } = require('../src/utils/productValidation');

test('product validation accepts zero reorder and rejects negative or fractional values', () => {
  assert.equal(productValues({ name: 'Water', selling_price: '0.10', reorder_level: '0' })[7], 0);
  for (const body of [{ name: 'Water', selling_price: '-1' }, { name: 'Water', selling_price: '1', stock_quantity: '1.5' }, { name: '', selling_price: '1' }]) assert.throws(() => productValues(body));
});

test('cart recovery refreshes price, limits stock, removes unavailable products, and retains checkout token', () => {
  const elements = new Map();
  const storage = new Map();
  const token = '11111111-1111-4111-8111-111111111111';
  const key = 'pos-draft-7';
  storage.set(key, JSON.stringify({ items: [{ id: '1', qty: 5 }, { id: '2', qty: 1 }], paid: '20', token }));
  const tile = { dataset: { id: '1', stock: '2', price: '0.10', name: 'Water', unit: 'pc' } };
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', validity: { valid: true }, dataset: { userId: 7 }, elements: { checkout_token: { value: 'new' } }, listeners: {}, classList: { toggle() {} }, addEventListener(type, handler) { this.listeners[type] = handler; }, appendChild() {}, querySelectorAll() { return id === 'productGrid' ? [tile] : []; } });
    return elements.get(id);
  }
  vm.runInNewContext(fs.readFileSync('public/js/pos.js', 'utf8'), {
    document: { getElementById: element, createElement: () => ({ innerHTML: '', textContent: '' }), addEventListener() {} },
    window: { addEventListener() {}, confirm: () => true },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout, clearTimeout,
  });
  assert.equal(element('cartTotal').textContent, '\u20b10.20');
  assert.equal(element('amountPaid').value, '20');
  assert.match(element('cartRecoveryStatus').textContent, /adjusted/);
  assert.equal(JSON.parse(storage.get(key)).items.length, 1);
  assert.equal(element('checkoutForm').elements.checkout_token.value, token);
  element('clearCart').listeners.click();
  assert(!storage.has(key));
});
