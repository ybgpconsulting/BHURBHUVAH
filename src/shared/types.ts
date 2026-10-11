// Shared types between client and server

export type UserRole = 'owner' | 'manager' | 'delivery_partner';
export type CustomerStatus = 'active' | 'inactive' | 'archived';
export type SubscriptionStatus = 'active' | 'paused' | 'expired' | 'cancelled' | 'renewed';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'refunded';
export type DeliveryStatus = 'pending' | 'completed' | 'partial' | 'missed' | 'cancelled';
export type DispatchStatus = 'draft' | 'locked' | 'revised';
export type ChangeType = 'skip' | 'pause' | 'resume' | 'quantity_change' | 'product_change' | 'one_time_add' | 'permanent_change' | 'address_change' | 'route_change';
export type ChangeApprovalStatus = 'pending' | 'approved' | 'rejected' | 'applied';
export type FollowUpTaskType = 'renewal' | 'expiry_reminder' | 'general' | 'complaint' | 'feedback';
export type FollowUpStatus = 'pending' | 'contacted' | 'interested' | 'renewed' | 'not_interested' | 'no_response' | 'closed';
export type DurationType = 'fixed_days' | 'calendar_month';

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Route {
  id: string;
  name: string;
  description?: string;
  assigned_partner_id?: string;
  assigned_partner_name?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  customer_code: string;
  name: string;
  phone: string;
  whatsapp_phone?: string;
  address: string;
  area?: string;
  pincode?: string;
  route_id?: string;
  route_name?: string;
  assigned_partner_id?: string;
  assigned_partner_name?: string;
  delivery_instructions?: string;
  status: CustomerStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  default_price?: number;
  packing_notes?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PlanTemplate {
  id: string;
  name: string;
  duration_days: number;
  duration_type: DurationType;
  price?: number;
  description?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  customer_id: string;
  customer_name?: string;
  plan_template_id: string;
  plan_name?: string;
  start_date: string;
  end_date: string;
  delivery_days: string;
  status: SubscriptionStatus;
  price?: number;
  payment_status?: PaymentStatus;
  renewed_from_id?: string;
  notes?: string;
  items?: SubscriptionItem[];
  created_at: string;
  updated_at: string;
}

export interface SubscriptionItem {
  id: string;
  subscription_id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  unit_price?: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryChange {
  id: string;
  customer_id: string;
  customer_name?: string;
  subscription_id?: string;
  change_type: ChangeType;
  effective_date: string;
  end_date?: string;
  product_id?: string;
  product_name?: string;
  previous_value?: string;
  new_value?: string;
  previous_quantity?: number;
  new_quantity?: number;
  new_product_id?: string;
  new_product_name?: string;
  new_address?: string;
  new_route_id?: string;
  new_partner_id?: string;
  reason?: string;
  status: ChangeApprovalStatus;
  created_by: string;
  created_by_name?: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
}

export interface DispatchRun {
  id: string;
  delivery_date: string;
  status: DispatchStatus;
  revision: number;
  total_orders: number;
  total_quantity: number;
  generated_by: string;
  generated_by_name?: string;
  locked_by?: string;
  locked_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Delivery {
  id: string;
  dispatch_run_id: string;
  customer_id: string;
  subscription_id?: string;
  route_id?: string;
  route_name?: string;
  assigned_partner_id?: string;
  assigned_partner_name?: string;
  delivery_date: string;
  sequence_number?: number;
  customer_name: string;
  customer_phone?: string;
  delivery_address: string;
  delivery_instructions?: string;
  status: DeliveryStatus;
  completed_at?: string;
  completed_by?: string;
  exception_reason?: string;
  notes?: string;
  is_extra: boolean;
  items?: DeliveryItem[];
  created_at: string;
  updated_at: string;
}

export interface DeliveryItem {
  id: string;
  delivery_id: string;
  product_id: string;
  product_name: string;
  planned_quantity: number;
  actual_quantity?: number;
  unit: string;
  status: DeliveryStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface FollowUpTask {
  id: string;
  customer_id: string;
  customer_name?: string;
  customer_phone?: string;
  subscription_id?: string;
  plan_name?: string;
  subscription_start_date?: string;
  subscription_end_date?: string;
  product_summary?: string;
  task_type: FollowUpTaskType;
  status: FollowUpStatus;
  assigned_to?: string;
  assigned_to_name?: string;
  last_contact_date?: string;
  next_follow_up_date?: string;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Dashboard types
export interface DashboardMetrics {
  deliveries: {
    scheduled: number;
    completed: number;
    pending: number;
    missed: number;
    partial: number;
    cancelled: number;
    planned_quantity: number;
    actual_quantity: number;
    completion_pct: number;
  };
  customers: {
    total: number;
    active: number;
    inactive: number;
    paused: number;
    new_in_period: number;
    expiring_soon: number;
    renewed_in_period: number;
    expired: number;
  };
  operations: {
    active_partners: number;
    total_routes: number;
    assigned_deliveries: number;
    unassigned_deliveries: number;
    pending_dispatches: number;
    exceptions: number;
    expiring_today: number;
    expiring_3_days: number;
    expiring_7_days: number;
    expired_followup: number;
  };
  product_breakdown: Array<{
    product_id: string;
    product_name: string;
    planned_quantity: number;
    actual_quantity: number;
  }>;
}

export interface ChartDataPoint {
  date: string;
  label: string;
  value: number;
  value2?: number;
}
