const { query, getClient } = require('../config/db');
const { generateReceiptNo } = require('../utils/helpers');
const { setFlash } = require('../middleware/flash');
const { randomUUID } = require('node:crypto');
const { toCentavos, fromCentavos } = require('../utils/money');
const { saleHistory } = require('../utils/saleHistory');

async function posScreen(req, res, next) {
  try {
    const { rows: products } = await query(
      `SELECT products.*, categories.name AS category_name
       FROM products LEFT JOIN categories ON categories.id = products.category_id
       WHERE products.active = TRUE AND products.stock_quantity > 0 ORDER BY products.name`
    );
    res.render('pos/index', { title: 'Point of Sale', products, checkoutToken: randomUUID() });
  } catch (err) {
    next(err);
  }
}

async function searchProducts(req, res, next) {
  try {
    const q = `%${req.query.q || ''}%`;
    const { rows: products } = await query(
      `SELECT products.id, products.name, products.barcode, products.unit, products.selling_price,
              products.stock_quantity, products.reorder_level, categories.name AS category_name
       FROM products LEFT JOIN categories ON categories.id = products.category_id
       WHERE products.active = TRUE AND (products.name ILIKE $1 OR products.barcode ILIKE $1)
       ORDER BY products.name LIMIT 20`,
      [q]
    );
    res.json(products);
  } catch (err) {
    next(err);
  }
}

async function checkout(items, amountPaid, userId, token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) throw new Error('Reload the POS page before completing this sale.');
  if (!Array.isArray(items) || items.length === 0) throw new Error('Cart is empty.');
  const paidCents = toCentavos(amountPaid);
  const quantities = new Map();
  for (const item of items) {
    const id = Number(item && item.productId);
    const quantity = Number(item && item.quantity);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Invalid product or quantity.');
    const combined = (quantities.get(id) || 0) + quantity;
    if (!Number.isSafeInteger(combined) || combined > 2147483647) throw new Error('Quantity is too large.');
    quantities.set(id, combined);
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Serialize retries of this checkout, including concurrent requests.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId + ':' + token]);
    const existing = await client.query('SELECT id FROM sales WHERE user_id = $1 AND checkout_token = $2', [userId, token]);
    if (existing.rows.length) {
      await client.query('COMMIT');
      return existing.rows[0].id;
    }

    let total = 0;
    const resolvedItems = [];

    // Lock in a consistent order to avoid deadlocks between multi-product sales.
    for (const [productId, quantity] of [...quantities].sort((a, b) => a[0] - b[0])) {
      const { rows } = await client.query('SELECT * FROM products WHERE id = $1 AND active = TRUE FOR UPDATE', [
        productId,
      ]);
      const product = rows[0];
      if (!product) throw new Error('Product not found.');
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Invalid quantity for ${product.name}.`);
      if (product.stock_quantity < quantity) {
        throw new Error(`Not enough stock for "${product.name}" (only ${product.stock_quantity} ${product.unit} left).`);
      }
      const subtotal = toCentavos(product.selling_price) * quantity;
      total += subtotal;
      if (!Number.isSafeInteger(total) || total > 9999999999) throw new Error('Sale total is too large.');
      resolvedItems.push({ product, quantity, subtotal });
    }

    if (resolvedItems.length === 0) throw new Error('Cart is empty.');
    if (paidCents < total) throw new Error('Amount paid is less than the total.');

    const receiptNo = generateReceiptNo();
    const saleResult = await client.query(
      'INSERT INTO sales (receipt_no, user_id, total_amount, amount_paid, change_amount, checkout_token) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [receiptNo, userId, fromCentavos(total), fromCentavos(paidCents), fromCentavos(paidCents - total), token]
    );
    const saleId = saleResult.rows[0].id;

    for (const { product, quantity, subtotal } of resolvedItems) {
      await client.query(
        'INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal) VALUES ($1, $2, $3, $4, $5, $6)',
        [saleId, product.id, product.name, product.selling_price, quantity, fromCentavos(subtotal)]
      );
      await client.query('UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2', [
        product.stock_quantity - quantity,
        product.id,
      ]);
    }

    await client.query('COMMIT');
    return saleId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postCheckout(req, res) {
  try {
    const items = JSON.parse(req.body.items || '[]');
    const saleId = await checkout(items, req.body.amount_paid, req.session.user.id, req.body.checkout_token);
    res.redirect(`/pos/receipt/${saleId}`);
  } catch (err) {
    setFlash(req, 'error', err.message);
    res.redirect('/pos');
  }
}

async function viewReceipt(req, res, next) {
  try {
    const { rows } = await query('SELECT * FROM sales WHERE id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
    const sale = rows[0];
    if (!sale) return res.status(404).render('error', { title: 'Not Found', message: 'Receipt not found.' });
    const { rows: items } = await query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
    const history = await saleHistory(sale.id);
    res.render('pos/receipt', { title: 'Receipt', sale, items, history });
  } catch (err) {
    next(err);
  }
}

async function mySales(req, res, next) {
  try {
    const search = String(req.query.q || '').trim().slice(0, 100);
    const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(value)) ? value : null;
    const from = date(req.query.from);
    const to = date(req.query.to);
    const page = Math.max(1, Math.min(Number.parseInt(req.query.page, 10) || 1, 1000000));
    const pageSize = 25;
    const { rows: sales } = await query(
      `SELECT id, receipt_no, total_amount, net_amount, refunded_amount, voided_at, created_at FROM sales_net
       WHERE user_id = $1 AND receipt_no ILIKE $2
         AND ($3::date IS NULL OR created_at >= ($3::date)::timestamp AT TIME ZONE 'Asia/Manila')
         AND ($4::date IS NULL OR created_at < ($4::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
       ORDER BY created_at DESC, id DESC LIMIT $5 OFFSET $6`,
      [req.session.user.id, '%' + search + '%', from, to, pageSize + 1, (page - 1) * pageSize]
    );
    const link = target => '/pos/sales?' + new URLSearchParams({ q: search, from: from || '', to: to || '', page: String(target) });
    res.render('pos/sales', { title: 'My Sales', sales: sales.slice(0, pageSize), filters: { search, from: from || '', to: to || '' }, pagination: { page, previous: page > 1 ? link(page - 1) : null, next: sales.length > pageSize ? link(page + 1) : null } });
  } catch (err) {
    next(err);
  }
}

// ---- Inventory (view stock + submit reports) ----

async function inventoryScreen(req, res, next) {
  try {
    const [products, myReports] = await Promise.all([
      query('SELECT * FROM products WHERE active = TRUE ORDER BY name').then((r) => r.rows),
      query(
        `SELECT inventory_reports.*, products.name AS product_name
         FROM inventory_reports JOIN products ON products.id = inventory_reports.product_id
         WHERE inventory_reports.user_id = $1
         ORDER BY inventory_reports.created_at DESC LIMIT 20`,
        [req.session.user.id]
      ).then((r) => r.rows),
    ]);
    res.render('pos/inventory', { title: 'Inventory', products, myReports });
  } catch (err) {
    next(err);
  }
}

async function submitReport(productId, type, quantityChange, note, userId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
    const product = rows[0];
    if (!product) throw new Error('Product not found.');

    const newQuantity = product.stock_quantity + quantityChange;
    if (newQuantity < 0) throw new Error(`That would bring "${product.name}" below zero stock.`);

    await client.query('UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2', [
      newQuantity,
      productId,
    ]);
    await client.query(
      'INSERT INTO inventory_reports (user_id, product_id, type, quantity_change, note, previous_stock, new_stock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, productId, type, quantityChange, note || null, product.stock_quantity, newQuantity]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postInventoryReport(req, res) {
  const { product_id, type, quantity, note } = req.body;
  const productId = Number(product_id);
  const qty = Number(quantity);
  try {
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Select a valid product.');
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Enter a positive whole-number quantity.');
    if (!['restock', 'damaged', 'lost', 'correction'].includes(type)) throw new Error('Select a valid report type.');
    if (type === 'correction' && !String(note || '').trim()) throw new Error('A reason is required for stock corrections.');
    if (type === 'correction' && !['increase', 'decrease'].includes(req.body.direction)) throw new Error('Select the correction direction.');
    const signedQty = type === 'restock' || (type === 'correction' && req.body.direction === 'increase') ? qty : -qty;
    await submitReport(productId, type, signedQty, note, req.session.user.id);
    setFlash(req, 'success', 'Inventory report submitted.');
  } catch (err) {
    setFlash(req, 'error', err.message);
  }
  res.redirect('/pos/inventory');
}

module.exports = {
  posScreen,
  searchProducts,
  postCheckout,
  viewReceipt,
  mySales,
  inventoryScreen,
  submitReport,
  postInventoryReport,
};
