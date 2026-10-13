const { query } = require('../config/db');

async function saleHistory(saleId) {
  const { rows: refunds } = await query(
    `SELECT sale_refunds.*, users.full_name AS approved_by FROM sale_refunds
     JOIN users ON users.id = sale_refunds.admin_id WHERE sale_id = $1 ORDER BY sale_refunds.id`, [saleId]);
  const { rows: refundedItems } = await query(
    `SELECT sale_item_id, SUM(quantity)::integer AS refunded_quantity FROM sale_refund_items
     JOIN sale_refunds ON sale_refunds.id = refund_id WHERE sale_id = $1 GROUP BY sale_item_id`, [saleId]);
  const { rows: refundLines } = await query(
    `SELECT sale_refund_items.*, sale_items.product_name FROM sale_refund_items
     JOIN sale_items ON sale_items.id = sale_item_id JOIN sale_refunds ON sale_refunds.id = refund_id
     WHERE sale_refunds.sale_id = $1 ORDER BY refund_id, sale_refund_items.id`, [saleId]);
  const { rows: approvers } = await query('SELECT users.full_name FROM sales JOIN users ON users.id = voided_by WHERE sales.id = $1', [saleId]);
  return { refunds, refundedItems, refundLines, voidApprover: approvers[0]?.full_name, refundedTotal: refunds.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0) / 100 };
}

module.exports = { saleHistory };
