const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { setFlash } = require('../middleware/flash');

async function dashboard(req, res, next) {
  try {
    const [todayTotal, weekTotal, monthTotal, topProducts, lowStock, recentSales] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count
         FROM sales WHERE created_at::date = CURRENT_DATE`
      ).then((r) => r.rows[0]),
      query(
        `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count
         FROM sales WHERE created_at >= NOW() - INTERVAL '6 days'`
      ).then((r) => r.rows[0]),
      query(
        `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count
         FROM sales WHERE to_char(created_at, 'YYYY-MM') = to_char(NOW(), 'YYYY-MM')`
      ).then((r) => r.rows[0]),
      query(
        `SELECT sale_items.product_name, SUM(sale_items.quantity) AS units_sold, SUM(sale_items.subtotal) AS revenue
         FROM sale_items
         JOIN sales ON sales.id = sale_items.sale_id
         WHERE sales.created_at >= NOW() - INTERVAL '29 days'
         GROUP BY sale_items.product_id, sale_items.product_name
         ORDER BY revenue DESC
         LIMIT 5`
      ).then((r) => r.rows),
      query(
        `SELECT name, stock_quantity, reorder_level, unit FROM products
         WHERE active = TRUE AND stock_quantity <= reorder_level ORDER BY stock_quantity ASC`
      ).then((r) => r.rows),
      query(
        `SELECT sales.id, receipt_no, total_amount, sales.created_at, users.full_name AS cashier
         FROM sales JOIN users ON users.id = sales.user_id
         ORDER BY sales.created_at DESC LIMIT 8`
      ).then((r) => r.rows),
    ]);

    res.render('admin/dashboard', {
      title: 'Dashboard',
      todayTotal,
      weekTotal,
      monthTotal,
      topProducts,
      lowStock,
      recentSales,
    });
  } catch (err) {
    next(err);
  }
}

// ---- Products ----

async function listProducts(req, res, next) {
  try {
    const [products, categories] = await Promise.all([
      query(
        `SELECT products.*, categories.name AS category_name
         FROM products LEFT JOIN categories ON categories.id = products.category_id
         ORDER BY products.active DESC, products.name ASC`
      ).then((r) => r.rows),
      query('SELECT * FROM categories ORDER BY name').then((r) => r.rows),
    ]);
    res.render('admin/products', { title: 'Products', products, categories });
  } catch (err) {
    next(err);
  }
}

async function createProduct(req, res, next) {
  const { name, barcode, category_id, unit, cost_price, selling_price, stock_quantity, reorder_level } = req.body;
  try {
    await query(
      `INSERT INTO products (name, barcode, category_id, unit, cost_price, selling_price, stock_quantity, reorder_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        name,
        barcode || null,
        category_id || null,
        unit || 'pc',
        Number(cost_price) || 0,
        Number(selling_price) || 0,
        Number(stock_quantity) || 0,
        Number(reorder_level) || 5,
      ]
    );
    setFlash(req, 'success', `Product "${name}" added.`);
    res.redirect('/admin/products');
  } catch (err) {
    setFlash(req, 'error', `Could not add product: ${err.message}`);
    res.redirect('/admin/products');
  }
}

async function updateProduct(req, res, next) {
  const { id } = req.params;
  const { name, barcode, category_id, unit, cost_price, selling_price, stock_quantity, reorder_level, active } = req.body;
  try {
    await query(
      `UPDATE products SET name = $1, barcode = $2, category_id = $3, unit = $4, cost_price = $5, selling_price = $6,
       stock_quantity = $7, reorder_level = $8, active = $9, updated_at = NOW()
       WHERE id = $10`,
      [
        name,
        barcode || null,
        category_id || null,
        unit || 'pc',
        Number(cost_price) || 0,
        Number(selling_price) || 0,
        Number(stock_quantity) || 0,
        Number(reorder_level) || 5,
        Boolean(active),
        id,
      ]
    );
    setFlash(req, 'success', `Product "${name}" updated.`);
    res.redirect('/admin/products');
  } catch (err) {
    setFlash(req, 'error', `Could not update product: ${err.message}`);
    res.redirect('/admin/products');
  }
}

async function createCategory(req, res, next) {
  const { name } = req.body;
  try {
    if (name && name.trim()) {
      await query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name.trim()]);
    }
    res.redirect('/admin/products');
  } catch (err) {
    next(err);
  }
}

// ---- Users ----

async function listUsers(req, res, next) {
  try {
    const { rows: users } = await query(
      'SELECT id, username, full_name, role, active, created_at FROM users ORDER BY role, username'
    );
    res.render('admin/users', { title: 'Users', users });
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res, next) {
  const { username, password, full_name, role } = req.body;
  try {
    const hash = bcrypt.hashSync(password, 10);
    await query('INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)', [
      username,
      hash,
      full_name,
      role === 'admin' ? 'admin' : 'sales_rep',
    ]);
    setFlash(req, 'success', `User "${username}" created.`);
    res.redirect('/admin/users');
  } catch (err) {
    setFlash(req, 'error', `Could not create user: ${err.message}`);
    res.redirect('/admin/users');
  }
}

async function toggleUserActive(req, res, next) {
  const { id } = req.params;
  try {
    if (Number(id) === req.session.user.id) {
      setFlash(req, 'error', 'You cannot deactivate your own account.');
      return res.redirect('/admin/users');
    }
    await query('UPDATE users SET active = NOT active WHERE id = $1', [id]);
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
}

// ---- Sales ----

async function listSales(req, res, next) {
  const { from, to } = req.query;
  try {
    let text = `SELECT sales.id, receipt_no, total_amount, amount_paid, change_amount, sales.created_at, users.full_name AS cashier
                FROM sales JOIN users ON users.id = sales.user_id`;
    const conditions = [];
    const params = [];
    if (from) {
      params.push(from);
      conditions.push(`sales.created_at::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      conditions.push(`sales.created_at::date <= $${params.length}::date`);
    }
    if (conditions.length) text += ' WHERE ' + conditions.join(' AND ');
    text += ' ORDER BY sales.created_at DESC LIMIT 200';

    const { rows: sales } = await query(text, params);
    res.render('admin/sales', { title: 'Sales', sales, from: from || '', to: to || '' });
  } catch (err) {
    next(err);
  }
}

async function viewSale(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT sales.*, users.full_name AS cashier FROM sales JOIN users ON users.id = sales.user_id WHERE sales.id = $1`,
      [req.params.id]
    );
    const sale = rows[0];
    if (!sale) return res.status(404).render('error', { title: 'Not Found', message: 'Sale not found.' });
    const { rows: items } = await query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
    res.render('admin/sale_detail', { title: 'Sale Detail', sale, items });
  } catch (err) {
    next(err);
  }
}

// ---- Inventory reports (submitted by sales reps) ----

async function listInventoryReports(req, res, next) {
  try {
    const { rows: reports } = await query(
      `SELECT inventory_reports.*, products.name AS product_name, users.full_name AS reported_by
       FROM inventory_reports
       JOIN products ON products.id = inventory_reports.product_id
       JOIN users ON users.id = inventory_reports.user_id
       ORDER BY inventory_reports.created_at DESC LIMIT 200`
    );
    res.render('admin/inventory_reports', { title: 'Inventory Reports', reports });
  } catch (err) {
    next(err);
  }
}

// ---- JSON API for dashboard chart ----

async function salesChartData(req, res, next) {
  try {
    const days = Math.max(1, Math.min(Math.floor(Number(req.query.days)) || 7, 90));
    const range = req.query.range;
    const { rows } = await query(
      `WITH bounds AS (
         SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date AS today,
           CASE WHEN $1 = 'today' THEN (NOW() AT TIME ZONE 'Asia/Manila')::date
                WHEN $1 = 'month' THEN date_trunc('month', NOW() AT TIME ZONE 'Asia/Manila')::date
                ELSE (NOW() AT TIME ZONE 'Asia/Manila')::date - ($2::integer - 1) END AS start_day
       ), dates AS (
         SELECT generate_series(start_day::timestamp, today::timestamp, INTERVAL '1 day') AS day FROM bounds
       )
       SELECT to_char(dates.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(sales.total_amount), 0) AS total
       FROM dates LEFT JOIN sales
         ON sales.created_at >= dates.day AT TIME ZONE 'Asia/Manila'
        AND sales.created_at < (dates.day + INTERVAL '1 day') AT TIME ZONE 'Asia/Manila'
       GROUP BY dates.day ORDER BY dates.day`,
      [range || 'week', range === 'week' ? 7 : days]
    );
    const labels = rows.map(r => r.day);
    const totals = rows.map(r => Number(r.total));
    res.json({ labels, totals });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  dashboard,
  listProducts,
  createProduct,
  updateProduct,
  createCategory,
  listUsers,
  createUser,
  toggleUserActive,
  listSales,
  viewSale,
  listInventoryReports,
  salesChartData,
};
