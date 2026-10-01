import { fmtDate, fmtDateTime, fmtTime } from "./time";
import { BOOKING_STATUS } from "./labels";
import type { Booking } from "./types";

export type ColKind = "text" | "money" | "datetime" | "date" | "int" | "phone";
export interface Col {
  key: string; label: string; kind: ColKind;
  /** Khóa sắp xếp ở máy chủ; undefined = không hỗ trợ sắp xếp */
  sort?: string;
  value: (b: Booking) => string | number | null;
  width?: number;
}

const depositState = (b: Booking) => (Number(b.deposit_amount ?? 0) > 0 ? "Đã cọc" : "Chưa cọc");

export const COLUMNS: Col[] = [
  { key: "code", label: "Mã đặt chỗ", kind: "text", sort: "code", value: (b) => b.code, width: 14 },
  { key: "start_at", label: "Ngày giờ diễn ra", kind: "datetime", sort: "start_at", value: (b) => b.start_at, width: 18 },
  { key: "end_at", label: "Giờ kết thúc dự kiến", kind: "datetime", value: (b) => b.end_at, width: 18 },
  { key: "customer_name", label: "Tên khách đặt", kind: "text", sort: "customer_name", value: (b) => b.customer_name ?? (b.is_walk_in ? "Khách vãng lai" : ""), width: 22 },
  { key: "customer_phone", label: "Số điện thoại", kind: "phone", sort: "customer_phone", value: (b) => b.customer_phone, width: 15 },
  { key: "event_name", label: "Tên tiệc / Tên bàn đặt", kind: "text", sort: "event_name", value: (b) => b.event_name, width: 24 },
  { key: "tables", label: "Bàn", kind: "text", value: (b) => b.tables.map((t) => t.code).join(", "), width: 16 },
  { key: "table_count", label: "Số bàn", kind: "int", value: (b) => b.tables.length, width: 8 },
  { key: "party_size", label: "Số lượng khách", kind: "int", sort: "party_size", value: (b) => b.party_size, width: 10 },
  { key: "children_count", label: "Trẻ em đi kèm", kind: "int", sort: "children_count", value: (b) => b.children_count, width: 10 },
  { key: "status", label: "Trạng thái", kind: "text", sort: "status", value: (b) => BOOKING_STATUS[b.status].label, width: 14 },
  { key: "consultant", label: "Nhân viên tư vấn", kind: "text", sort: "consultant", value: (b) => b.consultant_name, width: 18 },
  { key: "source", label: "Nguồn khách", kind: "text", value: (b) => b.source_label, width: 16 },
  { key: "booked_at", label: "Ngày giờ khách đặt", kind: "datetime", sort: "booked_at", value: (b) => b.booked_at, width: 18 },
  { key: "purpose", label: "Thể loại / Mục đích tiệc", kind: "text", value: (b) => b.purpose_label, width: 20 },
  { key: "items", label: "Món yêu cầu", kind: "text", value: (b) => b.items.map((i) => `${i.name} ×${i.qty}${i.note ? ` (${i.note})` : ""}`).join("; "), width: 30 },
  { key: "decoration", label: "Trang trí bàn tiệc", kind: "text", value: (b) => b.decoration, width: 24 },
  { key: "deposit_amount", label: "Số tiền đặt cọc (VND)", kind: "money", sort: "deposit_amount", value: (b) => (b.deposit_amount === null ? null : Number(b.deposit_amount)), width: 16 },
  { key: "deposit_status", label: "Tình trạng cọc", kind: "text", sort: "deposit_amount", value: depositState, width: 14 },
  { key: "deposit_method", label: "Phương thức cọc", kind: "text", value: (b) => b.deposit_method_label, width: 16 },
  { key: "deposit_date", label: "Ngày cọc", kind: "date", sort: "deposit_date", value: (b) => b.deposit_date, width: 12 },
  { key: "special_requests", label: "Yêu cầu riêng", kind: "text", value: (b) => b.special_requests, width: 30 },
  { key: "contract_code", label: "Mã HĐ", kind: "text", sort: "contract_code", value: (b) => b.contract_code, width: 14 },
  { key: "cancel_reason", label: "Lý do hủy", kind: "text", value: (b) => b.cancel_reason, width: 22 },
  { key: "created_at", label: "Thời điểm nhập hệ thống", kind: "datetime", sort: "created_at", value: (b) => b.created_at, width: 18 },
  { key: "created_by", label: "Người tạo", kind: "text", value: (b) => b.created_by_name, width: 16 },
  { key: "updated_at", label: "Sửa lần cuối lúc", kind: "datetime", value: (b) => b.updated_at, width: 18 },
  { key: "updated_by", label: "Người sửa cuối", kind: "text", value: (b) => b.updated_by_name, width: 16 },
];
export const COL_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));
export const DEFAULT_COLS = ["code", "start_at", "customer_name", "customer_phone", "event_name", "tables", "party_size", "status", "deposit_amount", "consultant"];

/** Hiển thị trên màn hình */
export function display(c: Col, b: Booking): string {
  const v = c.value(b);
  if (v === null || v === "") return "";
  if (c.kind === "datetime") return fmtDateTime(String(v));
  if (c.kind === "date") return fmtDate(String(v));
  if (c.kind === "money") return new Intl.NumberFormat("vi-VN").format(Number(v));
  return String(v);
}
export { fmtTime };
