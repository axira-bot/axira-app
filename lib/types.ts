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
}
