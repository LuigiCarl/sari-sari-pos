const { getClient, query } = require('../config/db');
const { toCentavos, fromCentavos } = require('../utils/money');
const { setFlash } = require('../middleware/flash');

async function restoreStock(client, productId, quantity, adminId, note) {
  const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
  const product = rows[0];
  if (!product) throw new Error('Product no longer exists.');
  const after = product.stock_quantity + quantity;
  await client.query('UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2', [after, productId]);
  await client.query('INSERT INTO inventory_reports (user_id, product_id, type, quantity_change, note, previous_stock, new_stock) VALUES ($1,$2,$3,$4,$5,$6,$7)', [adminId, productId, 'correction', quantity, note, product.stock_quantity, after]);
}

async function processReturn(req, res) {
  let client;
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new Error('A reason is required.');
    const mode = req.body.mode;
    if (!['void', 'refund'].includes(mode)) throw new Error('Select void or refund.');
    const token = req.body.request_token;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token || '')) throw new Error('Reload sale details and retry.');
    client = await getClient();
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [req.params.id]);
    const sale = rows[0];
    if (!sale) throw new Error('Sale not found.');
    const prior = await client.query('SELECT * FROM sale_refunds WHERE sale_id = $1', [sale.id]);
    const repeated = prior.rows.find(r => r.request_token === token);
    if (repeated) {
      await client.query('COMMIT');
      return res.redirect(`/admin/refunds/${repeated.id}`);
    }
    if (sale.voided_at) throw new Error('This sale has already been voided.');
    const { rows: items } = await client.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY product_id, id', [sale.id]);
    if (mode === 'void') {
      if (prior.rows.length) throw new Error('A refunded sale cannot be voided.');
      await client.query('UPDATE sales SET voided_at = NOW(), voided_by = $1, void_reason = $2 WHERE id = $3', [req.session.user.id, reason, sale.id]);
      if (req.body.restore_stock === '1') {
        for (const item of items) await restoreStock(client, item.product_id, item.quantity, req.session.user.id, `Void ${sale.receipt_no}: ${reason}`);
      }
      await client.query('COMMIT');
      setFlash(req, 'success', 'Sale voided. Original receipt amounts are preserved.');
      return res.redirect(`/admin/sales/${sale.id}`);
    }
    const { rows: refunded } = await client.query('SELECT sale_item_id, SUM(quantity)::integer AS quantity FROM sale_refund_items JOIN sale_refunds ON sale_refunds.id = refund_id WHERE sale_id = $1 GROUP BY sale_item_id', [sale.id]);
    const already = new Map(refunded.map(r => [r.sale_item_id, r.quantity]));
    const selected = [];
    let total = 0;
    for (const item of items) {
      const raw = req.body['qty_' + item.id];
      const quantity = raw == null || raw === '' ? 0 : Number(raw);
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > item.quantity - (already.get(item.id) || 0)) throw new Error(`Invalid refund quantity for ${item.product_name}.`);
      if (!quantity) continue;
      const amount = toCentavos(item.unit_price) * quantity;
      total += amount;
      selected.push({ item, quantity, amount, restock: req.body['restock_' + item.id] === '1' });
    }
    if (!selected.length) throw new Error('Select at least one item quantity to refund.');
    const refund = await client.query('INSERT INTO sale_refunds (sale_id, admin_id, reason, amount, request_token) VALUES ($1,$2,$3,$4,$5) RETURNING id', [sale.id, req.session.user.id, reason, fromCentavos(total), token]);
    const refundId = refund.rows[0].id;
    for (const entry of selected) {
      await client.query('INSERT INTO sale_refund_items (refund_id, sale_item_id, quantity, restocked, amount) VALUES ($1,$2,$3,$4,$5)', [refundId, entry.item.id, entry.quantity, entry.restock, fromCentavos(entry.amount)]);
      if (entry.restock) await restoreStock(client, entry.item.product_id, entry.quantity, req.session.user.id, `Refund ${sale.receipt_no}: ${reason}`);
    }
    await client.query('COMMIT');
    res.redirect(`/admin/refunds/${refundId}`);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    setFlash(req, 'error', error.message);
    res.redirect(`/admin/sales/${req.params.id}`);
  } finally {
    if (client) client.release();
  }
}

async function refundReceipt(req, res, next) {
  try {
    const { rows } = await query('SELECT sale_refunds.*, sales.receipt_no, users.full_name AS approved_by FROM sale_refunds JOIN sales ON sales.id = sale_id JOIN users ON users.id = admin_id WHERE sale_refunds.id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).render('error', { title: 'Not Found', message: 'Refund not found.' });
    const { rows: items } = await query('SELECT sale_refund_items.*, sale_items.product_name FROM sale_refund_items JOIN sale_items ON sale_items.id = sale_item_id WHERE refund_id = $1', [req.params.id]);
    res.render('admin/refund_receipt', { title: 'Refund receipt', refund: rows[0], items });
  } catch (error) { next(error); }
}

module.exports = { processReturn, refundReceipt };
