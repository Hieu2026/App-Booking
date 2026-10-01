export type BookingStatus = "pending" | "confirmed" | "arrived" | "completed" | "cancelled" | "no_show";
export type TableOps = "ready" | "serving" | "cleaning" | "suspended";
export type Role = "receptionist" | "manager";

export interface TableRef { id: string; code: string; floor_code: string; capacity: number }
export interface BookingItem { name: string; qty: number; note: string | null }
export interface Booking {
  id: string; code: string; status: BookingStatus; is_walk_in: boolean; is_demo: boolean;
  consultant_id: string | null; consultant_name: string | null;
  event_name: string | null; customer_name: string | null; customer_phone: string | null;
  source_id: string | null; source_label: string | null; purpose_id: string | null; purpose_label: string | null;
  start_at: string; end_at: string; booked_at: string | null;
  party_size: number; children_count: number; decoration: string | null; special_requests: string | null;
  deposit_amount: number | string | null; deposit_method_id: string | null; deposit_method_label: string | null;
  deposit_date: string | null; contract_code: string | null;
  cancel_reason: string | null; change_note: string | null; override_reason: string | null;
  version: number; created_at: string; created_by_name: string | null; updated_at: string; updated_by_name: string | null;
  tables: TableRef[]; items: BookingItem[];
}
export interface BoardTable {
  id: string; code: string; floor_code: string; capacity: number; ops_status: TableOps; active: boolean;
  note: string | null; serving_booking_id: string | null; serving_booking_code: string | null;
}
export interface Floor { code: string; name: string; sort_order: number }
export interface Lookup { id: string; kind: "source" | "purpose" | "deposit_method"; label: string; active: boolean; sort_order: number }
export interface Settings { open_time: string; close_time: string; buffer_minutes: number; default_duration_minutes: number }
export interface StaffRef { id: string; full_name: string; role: Role }
export interface AppContext {
  now: string; me: StaffRef; settings: Settings; floors: Floor[]; lookups: Lookup[]; staff: StaffRef[];
}
export interface Board { now: string; tables: BoardTable[]; bookings: Booking[] }
export interface Availability {
  id: string; code: string; floor_code: string; capacity: number; ops_status: TableOps;
  conflict: null | { booking_id: string; booking_code: string; customer_name: string | null; event_name: string | null; status: BookingStatus; start_at: string; end_at: string };
  next_start: string | null;
  serving: null | { booking_code: string; end_at: string };
}
export interface HistoryEntry { id: number; at: string; actor_name: string | null; action: string; summary: string | null; changes: any }

export const HOLDING: BookingStatus[] = ["pending", "confirmed", "arrived"];
