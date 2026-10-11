-- Seed data for development environment
-- WARNING: This is demonstration data only. Do not use in production.

-- Users
INSERT OR IGNORE INTO users (id, email, name, phone, password_hash, role, is_active)
VALUES
  ('user-owner', 'owner@example.com', 'Admin Owner', '9999900000', 'c2FsdA==:aGFzaA==', 'owner', 1),
  ('user-manager', 'manager@example.com', 'Dispatch Manager', '9999900001', 'c2FsdA==:aGFzaA==', 'manager', 1),
  ('user-partner-1', 'partner1@example.com', 'Ramesh Delivery', '9999900002', 'c2FsdA==:aGFzaA==', 'delivery_partner', 1),
  ('user-partner-2', 'partner2@example.com', 'Suresh Delivery', '9999900003', 'c2FsdA==:aGFzaA==', 'delivery_partner', 1);

-- Products
INSERT OR IGNORE INTO products (id, name, category, unit, default_price, is_active, sort_order)
VALUES
  ('prod-001', 'A2 Cow Milk', 'milk', 'litre', 70, 1, 1),
  ('prod-002', 'A2 Buffalo Milk', 'milk', 'litre', 80, 1, 2),
  ('prod-003', 'A2 Cow Milk (500ml)', 'milk', 'litre', 40, 1, 3),
  ('prod-004', 'Farm Fresh Curd', 'dairy', 'kg', 90, 1, 4);

-- Plan templates
INSERT OR IGNORE INTO plan_templates (id, name, duration_days, duration_type, price, description, is_active, sort_order)
VALUES
  ('plan-001', '1-Day Trial', 1, 'fixed_days', NULL, 'Single day trial delivery', 1, 1),
  ('plan-002', '3-Day Starter', 3, 'fixed_days', NULL, '3-day starter pack', 1, 2),
  ('plan-003', '10-Day Plan', 10, 'fixed_days', NULL, '10-day regular plan', 1, 3),
  ('plan-004', 'Monthly Plan', 1, 'calendar_month', NULL, 'Full calendar month subscription', 1, 4);

-- Routes
INSERT OR IGNORE INTO routes (id, name, description, is_active, sort_order)
VALUES
  ('route-001', 'Sector 15-18', 'Covers sectors 15, 16, 17, 18', 1, 1),
  ('route-002', 'Sector 19-22', 'Covers sectors 19, 20, 21, 22', 1, 2),
  ('route-003', 'Sector 23-26', 'Covers sectors 23, 24, 25, 26', 1, 3),
  ('route-004', 'DLF Phase 1-2', 'DLF Phase 1 and Phase 2', 1, 4),
  ('route-005', 'Sushant Lok', 'Sushant Lok area', 1, 5);

-- Sample customers (DEMO DATA)
INSERT OR IGNORE INTO customers (id, customer_code, name, phone, whatsapp_phone, address, area, pincode, route_id, delivery_instructions, status)
VALUES
  ('cust-001', 'CUST-0001', 'Rajesh Kumar', '9876543210', '9876543210', 'H.No. 234, Sector 15', 'Sector 15', '122001', 'route-001', 'Ring doorbell twice', 'active'),
  ('cust-002', 'CUST-0002', 'Priya Sharma', '9876543211', NULL, 'Villa 12, Sector 17', 'Sector 17', '122001', 'route-001', 'Leave at gate', 'active'),
  ('cust-003', 'CUST-0003', 'Amit Gupta', '9876543212', '9876543212', 'Flat 401, Tower B, Sector 19', 'Sector 19', '122002', 'route-002', NULL, 'active'),
  ('cust-004', 'CUST-0004', 'Sunita Verma', '9876543213', NULL, 'B-45, Sector 21', 'Sector 21', '122002', 'route-002', 'Keep at door, patient is elderly', 'active'),
  ('cust-005', 'CUST-0005', 'Vikram Singh', '9876543214', '9876543214', 'Plot 78, DLF Phase 1', 'DLF Phase 1', '122003', 'route-004', NULL, 'active'),
  ('cust-006', 'CUST-0006', 'Meera Patel', '9876543215', NULL, 'J-12, Sushant Lok', 'Sushant Lok', '122004', 'route-005', 'Call before delivery', 'active'),
  ('cust-007', 'CUST-0007', 'Ravi Agarwal', '9876543216', '9876543216', 'House 56, Sector 23', 'Sector 23', '122003', 'route-003', NULL, 'active'),
  ('cust-008', 'CUST-0008', 'Neha Joshi', '9876543217', NULL, 'Flat 201, Sector 16', 'Sector 16', '122001', 'route-001', 'Use side entrance', 'active'),
  ('cust-009', 'CUST-0009', 'Deepak Yadav', '9876543218', NULL, 'C-23, Sector 20', 'Sector 20', '122002', 'route-002', NULL, 'inactive'),
  ('cust-010', 'CUST-0010', 'Anita Reddy', '9876543219', '9876543219', 'Villa 8, DLF Phase 2', 'DLF Phase 2', '122003', 'route-004', 'Morning delivery only', 'active');

-- Sample subscriptions (DEMO DATA - using dates relative to current)
INSERT OR IGNORE INTO subscriptions (id, customer_id, plan_template_id, start_date, end_date, delivery_days, status, price, payment_status)
VALUES
  ('sub-001', 'cust-001', 'plan-003', '2026-10-05', '2026-10-14', '1,2,3,4,5,6', 'active', 700, 'paid'),
  ('sub-002', 'cust-002', 'plan-004', '2026-10-01', '2026-10-31', '1,2,3,4,5,6,7', 'active', 2170, 'paid'),
  ('sub-003', 'cust-003', 'plan-003', '2026-10-08', '2026-10-17', '1,2,3,4,5', 'active', 800, 'pending'),
  ('sub-004', 'cust-004', 'plan-004', '2026-10-01', '2026-10-31', '1,2,3,4,5,6,7', 'active', 2400, 'paid'),
  ('sub-005', 'cust-005', 'plan-002', '2026-10-09', '2026-10-11', '1,2,3,4,5,6', 'active', 240, 'paid'),
  ('sub-006', 'cust-006', 'plan-003', '2026-10-01', '2026-10-10', '1,2,3,4,5,6', 'active', 700, 'paid'),
  ('sub-007', 'cust-007', 'plan-004', '2026-10-01', '2026-10-31', '1,2,3,4,5,6,7', 'active', 2170, 'paid'),
  ('sub-008', 'cust-008', 'plan-003', '2026-10-06', '2026-10-15', '1,2,3,4,5', 'active', 700, 'partial'),
  ('sub-009', 'cust-010', 'plan-004', '2026-10-01', '2026-10-31', '1,2,3,4,5,6', 'active', 2400, 'paid');

-- Subscription items (what each customer gets daily)
INSERT OR IGNORE INTO subscription_items (id, subscription_id, product_id, quantity, unit_price)
VALUES
  ('si-001', 'sub-001', 'prod-001', 1, 70),
  ('si-002', 'sub-002', 'prod-001', 1, 70),
  ('si-003', 'sub-003', 'prod-002', 1, 80),
  ('si-004', 'sub-004', 'prod-002', 1.5, 80),
  ('si-005', 'sub-005', 'prod-001', 1, 70),
  ('si-006', 'sub-005', 'prod-002', 0.5, 80),
  ('si-007', 'sub-006', 'prod-001', 1, 70),
  ('si-008', 'sub-007', 'prod-001', 1, 70),
  ('si-009', 'sub-008', 'prod-001', 1, 70),
  ('si-010', 'sub-009', 'prod-002', 2, 80);

-- Sample delivery changes (DEMO DATA)
INSERT OR IGNORE INTO delivery_changes (id, customer_id, subscription_id, change_type, effective_date, previous_quantity, new_quantity, reason, status, created_by)
VALUES
  ('chg-001', 'cust-001', 'sub-001', 'skip', '2026-10-12', NULL, NULL, 'Customer travelling', 'approved', 'user-owner'),
  ('chg-002', 'cust-003', 'sub-003', 'quantity_change', '2026-10-12', 1, 2, 'Customer wants extra for guests', 'approved', 'user-owner');
