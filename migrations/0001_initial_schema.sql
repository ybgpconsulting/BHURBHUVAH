-- Milk Delivery Management System - Initial Schema
-- All timestamps stored as ISO 8601 UTC strings
-- Business dates use Asia/Kolkata timezone in application logic

-- ============================================================
-- USERS & AUTH
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'manager', 'delivery_partner')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ============================================================
-- ROUTES
-- ============================================================
CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  assigned_partner_id TEXT REFERENCES users(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  customer_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp_phone TEXT,
  address TEXT NOT NULL,
  area TEXT,
  pincode TEXT,
  route_id TEXT REFERENCES routes(id),
  assigned_partner_id TEXT REFERENCES users(id),
  delivery_instructions TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'archived')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_customers_status ON customers(status);
CREATE INDEX idx_customers_route ON customers(route_id);
CREATE INDEX idx_customers_partner ON customers(assigned_partner_id);
CREATE INDEX idx_customers_code ON customers(customer_code);
CREATE INDEX idx_customers_phone ON customers(phone);

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'milk',
  unit TEXT NOT NULL DEFAULT 'litre',
  default_price REAL,
  packing_notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- PLAN TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS plan_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  duration_type TEXT NOT NULL DEFAULT 'fixed_days' CHECK(duration_type IN ('fixed_days', 'calendar_month')),
  price REAL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  plan_template_id TEXT NOT NULL REFERENCES plan_templates(id),
  start_date TEXT NOT NULL, -- YYYY-MM-DD
  end_date TEXT NOT NULL,   -- YYYY-MM-DD
  delivery_days TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7', -- 1=Mon..7=Sun CSV
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'expired', 'cancelled', 'renewed')),
  price REAL,
  payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending', 'partial', 'paid', 'refunded')),
  renewed_from_id TEXT REFERENCES subscriptions(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subscriptions_customer ON subscriptions(customer_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_dates ON subscriptions(start_date, end_date);

-- ============================================================
-- SUBSCRIPTION ITEMS (products per subscription)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_items (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unit_price REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subscription_id, product_id)
);
CREATE INDEX idx_sub_items_subscription ON subscription_items(subscription_id);

-- ============================================================
-- DELIVERY CHANGES (skip, pause, qty change, product change, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_changes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  subscription_id TEXT REFERENCES subscriptions(id),
  change_type TEXT NOT NULL CHECK(change_type IN (
    'skip', 'pause', 'resume', 'quantity_change', 'product_change',
    'one_time_add', 'permanent_change', 'address_change', 'route_change'
  )),
  effective_date TEXT NOT NULL,    -- YYYY-MM-DD
  end_date TEXT,                   -- for pause ranges
  product_id TEXT REFERENCES products(id),
  previous_value TEXT,
  new_value TEXT,
  previous_quantity REAL,
  new_quantity REAL,
  new_product_id TEXT REFERENCES products(id),
  new_address TEXT,
  new_route_id TEXT REFERENCES routes(id),
  new_partner_id TEXT REFERENCES users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected', 'applied')),
  created_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_changes_customer ON delivery_changes(customer_id);
CREATE INDEX idx_changes_subscription ON delivery_changes(subscription_id);
CREATE INDEX idx_changes_effective ON delivery_changes(effective_date);
CREATE INDEX idx_changes_type ON delivery_changes(change_type);

-- ============================================================
-- DISPATCH RUNS
-- ============================================================
CREATE TABLE IF NOT EXISTS dispatch_runs (
  id TEXT PRIMARY KEY,
  delivery_date TEXT NOT NULL, -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'locked', 'revised')),
  revision INTEGER NOT NULL DEFAULT 1,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_quantity REAL NOT NULL DEFAULT 0,
  generated_by TEXT NOT NULL REFERENCES users(id),
  locked_by TEXT REFERENCES users(id),
  locked_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(delivery_date, revision)
);
CREATE INDEX idx_dispatch_date ON dispatch_runs(delivery_date);

-- ============================================================
-- DELIVERIES (one per customer per dispatch run)
-- ============================================================
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  dispatch_run_id TEXT NOT NULL REFERENCES dispatch_runs(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  subscription_id TEXT REFERENCES subscriptions(id),
  route_id TEXT REFERENCES routes(id),
  assigned_partner_id TEXT REFERENCES users(id),
  delivery_date TEXT NOT NULL,
  sequence_number INTEGER,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  delivery_address TEXT NOT NULL,
  delivery_instructions TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending', 'completed', 'partial', 'missed', 'cancelled'
  )),
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id),
  exception_reason TEXT,
  notes TEXT,
  is_extra INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dispatch_run_id, customer_id, subscription_id)
);
CREATE INDEX idx_deliveries_dispatch ON deliveries(dispatch_run_id);
CREATE INDEX idx_deliveries_customer ON deliveries(customer_id);
CREATE INDEX idx_deliveries_partner ON deliveries(assigned_partner_id);
CREATE INDEX idx_deliveries_date ON deliveries(delivery_date);
CREATE INDEX idx_deliveries_status ON deliveries(status);

-- ============================================================
-- DELIVERY ITEMS (product line items per delivery)
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_items (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  planned_quantity REAL NOT NULL,
  actual_quantity REAL,
  unit TEXT NOT NULL DEFAULT 'litre',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending', 'delivered', 'partial', 'missed', 'cancelled'
  )),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_delivery_items_delivery ON delivery_items(delivery_id);
CREATE INDEX idx_delivery_items_product ON delivery_items(product_id);

-- ============================================================
-- FOLLOW-UP TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS follow_up_tasks (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  subscription_id TEXT REFERENCES subscriptions(id),
  task_type TEXT NOT NULL DEFAULT 'renewal' CHECK(task_type IN (
    'renewal', 'expiry_reminder', 'general', 'complaint', 'feedback'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending', 'contacted', 'interested', 'renewed', 'not_interested', 'no_response', 'closed'
  )),
  assigned_to TEXT REFERENCES users(id),
  last_contact_date TEXT,
  next_follow_up_date TEXT,
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_followup_customer ON follow_up_tasks(customer_id);
CREATE INDEX idx_followup_status ON follow_up_tasks(status);
CREATE INDEX idx_followup_next ON follow_up_tasks(next_follow_up_date);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_values TEXT, -- JSON
  new_values TEXT, -- JSON
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
