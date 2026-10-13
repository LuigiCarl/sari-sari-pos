// Run against a temporary isolated schema, never against existing store tables.
require('dotenv').config({ path: '.env.local', quiet: true });
const { Pool } = require('pg');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
let connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
// Isolated search_path requires a direct connection, not Neon's transaction pooler.
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname.endsWith('.neon.tech')) url.hostname = url.hostname.replace('-pooler.', '.');
  connectionString = url.toString();
}
const schema = 'pos_verify_' + randomUUID().replaceAll('-', '');
const settings = { connectionString, connectionTimeoutMillis: 10000, ssl: /localhost|127\.0\.0\.1/.test(connectionString || '') ? false : { rejectUnauthorized: false } };

async function main() {
  if (!connectionString) throw new Error('Database configuration missing.');
  const setup = new Pool(settings);
  let pool;
  let created = false;
  try {
    await setup.query(`CREATE SCHEMA ${schema}`);
    created = true;
    pool = new Pool({ ...settings, options: '-c search_path=' + schema });
    const migration = fs.readFileSync('src/db/schema.sql', 'utf8');
    await pool.query(migration);
    await pool.query(migration);
    const dbPath = require.resolve('../src/config/db');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: (sql, params) => pool.query(sql, params), getClient: () => pool.connect() } };
    const { postCheckout } = require('../src/controllers/posController');
    const { processReturn } = require('../src/controllers/returnsController');
    const { updateProduct, dashboard, salesChartData } = require('../src/controllers/adminController');
    const { requireAuth } = require('../src/middleware/auth');
    const users = await pool.query("INSERT INTO users (username,password_hash,full_name,role) VALUES ('test_admin','unused','Admin','admin'),('test_rep','unused','Rep','sales_rep') RETURNING id,role");
    const admin = users.rows.find(u => u.role === 'admin').id;
    const rep = users.rows.find(u => u.role === 'sales_rep').id;
    const product = (await pool.query("INSERT INTO products (name,selling_price,stock_quantity) VALUES ('Test product',0.10,10) RETURNING id")).rows[0].id;
    const request = body => ({ body, session: { user: { id: rep } } });
    const send = async (handler, req) => { let redirect; await handler(req, { redirect: url => { redirect = url; } }); return { redirect, flash: req.session.flash }; };
    const token = randomUUID();
    const body = { items: JSON.stringify([{ productId: product, quantity: 1 }, { productId: product, quantity: 2 }]), amount_paid: '0.30', checkout_token: token };
    const repeated = await Promise.all([send(postCheckout, request(body)), send(postCheckout, request(body))]);
    assert.equal(repeated[0].redirect, repeated[1].redirect);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM sales')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT stock_quantity FROM products')).rows[0].stock_quantity, 7);
    const sale = (await pool.query('SELECT * FROM sales')).rows[0];
    const item = (await pool.query('SELECT * FROM sale_items')).rows[0];
    const returnReq = body => ({ params: { id: sale.id }, body, session: { user: { id: admin } } });
    const refundBody = { mode: 'refund', request_token: randomUUID(), reason: 'Damaged item returned', ['qty_' + item.id]: '1' };
    await Promise.all([send(processReturn, returnReq(refundBody)), send(processReturn, returnReq(refundBody))]);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM sale_refunds')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT stock_quantity FROM products')).rows[0].stock_quantity, 7);
    const excess = await send(processReturn, returnReq({ ...refundBody, request_token: randomUUID(), ['qty_' + item.id]: '3' }));
    assert.match(excess.flash.error, /Invalid refund quantity/);
    await send(processReturn, returnReq({ ...refundBody, request_token: randomUUID(), reason: 'Sellable return', ['qty_' + item.id]: '2', ['restock_' + item.id]: '1' }));
    assert.equal(Number((await pool.query('SELECT net_amount FROM sales_net')).rows[0].net_amount), 0);
    assert.equal((await pool.query('SELECT stock_quantity FROM products')).rows[0].stock_quantity, 9);
    assert.equal(Number((await pool.query('SELECT total_amount FROM sales')).rows[0].total_amount), 0.30);
    await send(updateProduct, { params: { id: product }, body: { name: 'Test product', selling_price: '0.10', stock_quantity: '12', reorder_level: '0', active: '1', stock_reason: 'Count correction' }, session: { user: { id: admin } } });
    assert.equal((await pool.query("SELECT previous_stock,new_stock FROM inventory_reports WHERE note LIKE 'Admin edit:%'")).rows[0].new_stock, 12);
    const second = await send(postCheckout, request({ ...body, checkout_token: randomUUID() }));
    const secondId = Number(second.redirect.split('/').pop());
    await send(processReturn, { params: { id: secondId }, body: { mode: 'void', request_token: randomUUID(), reason: 'Cancelled', restore_stock: '1' }, session: { user: { id: admin } } });
    assert.equal((await pool.query('SELECT stock_quantity FROM products')).rows[0].stock_quantity, 12);
    const rep2 = (await pool.query("INSERT INTO users (username,password_hash,full_name,role) VALUES ('rep2','unused','Rep 2','sales_rep') RETURNING id")).rows[0].id;
    const scarce = (await pool.query("INSERT INTO products (name,selling_price,stock_quantity) VALUES ('Last item',1.00,1) RETURNING id")).rows[0].id;
    const concurrent = await Promise.all([rep, rep2].map(id => send(postCheckout, { body: { items: JSON.stringify([{productId:scarce,quantity:1}]), amount_paid:'1.00', checkout_token:randomUUID() }, session:{user:{id}} })));
    assert.equal(concurrent.filter(result => result.redirect.startsWith('/pos/receipt/')).length,1);
    assert.equal(concurrent.filter(result => result.flash?.error?.includes('Not enough stock')).length,1);
    assert.equal((await pool.query('SELECT stock_quantity FROM products WHERE id = $1',[scarce])).rows[0].stock_quantity,0);
    await pool.query('UPDATE users SET active = FALSE WHERE id = $1', [rep]);
    const authReq = { session: { user: { id: rep } }, get: () => 'application/json' };
    let code;
    await requireAuth(authReq, { status: value => { code = value; return { json() {} }; }, locals: {}, set() {} }, error => { if (error) throw error; });
    assert.equal(code, 401);
    assert(!authReq.session.user);
    await dashboard({}, {render: (view,data) => assert.equal(Number(data.todayTotal.total),1)}, error => {throw error;});
    await salesChartData({query:{range:'today'}}, {json: data => assert.equal(data.totals[0],1)}, error => {throw error;});
    console.log('PASS: repeatable migrations, concurrent checkout/refund retries, refund limits, conditional stock restoration, immutable receipt amounts, net sales, admin stock audit, and deactivated sessions.');
  } finally {
    if (pool) await pool.end();
    if (created && /^pos_verify_[a-f0-9]{32}$/.test(schema)) await setup.query(`DROP SCHEMA ${schema} CASCADE`);
    await setup.end();
  }
}
main().catch(error => { console.error('Live verification failed:', (error.code || '') + ': ' + error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]')); process.exitCode = 1; });
