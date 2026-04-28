export interface Movement {
  id: string;
  date: string;
  type: string;
  category: string;
  description?: string;
  amount: number;
  currency: string;
  rate?: number;
  aed_equivalent?: number;
  pocket: string;
  deal_id?: string;
  payment_id?: string;
  reference?: string;
  created_at?: string;
}

export interface Car {
  id: string;
  brand: string;
  model: string;
  year: number;
  color?: string;
  mileage?: number;
  vin?: string;
  purchase_price: number;
  purchase_currency: string;
  purchase_rate?: number;
  location: string;
  owner: string;
  client_name?: string;
  status: string;
  notes?: string;
  supplier_paid?: number;
  supplier_owed?: number;
  country_of_origin?: string | null;
  photos?: string[] | null;
  // Extended specs
  transmission?: string | null;
  fuel_type?: string | null;
  engine?: string | null;
  features?: string[] | null;
  condition?: string | null;
  // New inventory intelligence fields
  is_published?: boolean | null;
  stock_type?: 'axira' | 'supplier' | null;
  supplier_name?: string | null;
  body_type?: string | null;
  drive_type?: string | null;
  doors?: number | null;
  seats?: number | null;
  grade?: string | null;
  body_issues?: string | null;
  display_status?: string | null;   // 'available' | 'in_transit' | 'sold' (auto-computed)
  status_override?: string | null;  // null = auto | 'available' | 'in_transit' | 'sold'
  sold_at?: string | null;
  sale_price_dzd?: number | null;   // Public listing price in DZD
  inventory_lifecycle_status?: string | null;
  linked_deal_id?: string | null;
  supplier_id?: string | null;
  supplier_catalog_id?: string | null;
}

export interface Employee {
  id: string;
  employee_code?: string | null;
  name: string | null;
  role: string | null;
  phone?: string | null;
  email?: string | null;
  base_salary?: number | null;
  salary_currency?: "DZD" | string | null;
  commission_per_deal?: number | null;
  commission_per_managed_deal?: number | null;
  start_date?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface Commission {
  id: string;
  employee_id: string;
  deal_id: string;
  amount: number | null;
  currency?: "DZD" | string | null;
  rate_snapshot?: number | null;
  type?: string | null;
  status?: string | null;
  month?: string | null;
  created_at?: string | null;
}

export interface Rent {
  id: string;
  description: string;
  annual_amount: number;
  monthly_amount?: number;
  daily_amount?: number;
  currency: string;
  start_date: string;
  end_date: string | null;
  pocket: string | null;
  payment_frequency: string;
  status: string;
  created_at?: string;
}

export interface Deal {
  id: string;
  client_name: string;
  client_id?: string;
  car_id: string;
  car_label: string;
  date: string;
  sale_dzd: number;
  rate: number;
  sale_aed: number;
  cost_car: number;
  cost_shipping: number;
  cost_inspection: number;
  cost_recovery: number;
  cost_maintenance: number;
  cost_other: number;
  total_expenses: number;
  profit: number;
  shipping_paid?: boolean;
  collected_dzd: number;
  pending_dzd: number;
  status: string;
  notes?: string;
  drive_link?: string | null;
  created_at?: string;
  sale_usd?: number | null;
  source?: "STOCK" | "PRE_ORDER_CATALOG" | "PRE_ORDER_CUSTOM" | null;
  lifecycle_status?: "PRE_ORDER" | "ORDERED" | "SHIPPED" | "ARRIVED" | "CLOSED" | "CANCELLED" | null;
  cancellation_reason?: "customer_cancelled" | "supplier_unavailable" | "other" | null;
  cancellation_note?: string | null;
  agreed_delivery_date?: string | null;
  inventory_car_id?: string | null;
  source_cost?: number | null;
  source_currency?: "USD" | "AED" | null;
  source_rate_to_dzd?: number | null;
  source_rate_to_aed?: number | null;
  margin_dzd?: number | null;
  margin_aed?: number | null;
  margin_pct?: number | null;
  custom_spec_signature?: string | null;
}
