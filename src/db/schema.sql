CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'sales_rep')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  barcode TEXT UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'pc',
  cost_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 5,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  receipt_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total_amount NUMERIC(10, 2) NOT NULL,
  amount_paid NUMERIC(10, 2) NOT NULL,
  change_amount NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('restock', 'damaged', 'lost', 'correction')),
  quantity_change INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS checkout_token UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_checkout_token ON sales(user_id, checkout_token);
ALTER TABLE inventory_reports ADD COLUMN IF NOT EXISTS previous_stock INTEGER;
ALTER TABLE inventory_reports ADD COLUMN IF NOT EXISTS new_stock INTEGER;
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reports_created_at ON inventory_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_reason TEXT;
CREATE TABLE IF NOT EXISTS sale_refunds (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  admin_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  request_token UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sale_refund_items (
  id SERIAL PRIMARY KEY,
  refund_id INTEGER NOT NULL REFERENCES sale_refunds(id),
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  restocked BOOLEAN NOT NULL DEFAULT FALSE,
  amount NUMERIC(10,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_refunds_sale ON sale_refunds(sale_id);
CREATE INDEX IF NOT EXISTS idx_refund_items_sale_item ON sale_refund_items(sale_item_id);

CREATE OR REPLACE VIEW sales_net AS
SELECT sales.*, COALESCE(refunds.refunded_amount, 0) AS refunded_amount,
  CASE WHEN sales.voided_at IS NOT NULL THEN 0 ELSE sales.total_amount - COALESCE(refunds.refunded_amount, 0) END AS net_amount
FROM sales LEFT JOIN (SELECT sale_id, SUM(amount) AS refunded_amount FROM sale_refunds GROUP BY sale_id) refunds ON refunds.sale_id = sales.id;
