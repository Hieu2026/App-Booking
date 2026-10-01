import type { BookingStatus, TableOps } from "./types";

export const BOOKING_STATUS: Record<BookingStatus, { label: string; cls: string }> = {
  pending: { label: "Chờ xác nhận", cls: "bg-amber-100 text-amber-900 ring-amber-300" },
  confirmed: { label: "Đã xác nhận", cls: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  arrived: { label: "Đã đến", cls: "bg-orange-100 text-orange-900 ring-orange-300" },
  completed: { label: "Hoàn tất", cls: "bg-stone-200 text-stone-700 ring-stone-300" },
  cancelled: { label: "Đã hủy", cls: "bg-stone-100 text-stone-500 ring-stone-300 line-through" },
  no_show: { label: "Không đến", cls: "bg-rose-100 text-rose-800 ring-rose-300" },
};
export const STATUS_ORDER: BookingStatus[] = ["pending", "confirmed", "arrived", "completed", "cancelled", "no_show"];

export const TABLE_OPS: Record<TableOps, string> = {
  ready: "Sẵn sàng", serving: "Đang phục vụ", cleaning: "Chờ dọn", suspended: "Tạm ngưng",
};

export const ACTION_LABEL: Record<string, string> = {
  create: "Tạo lượt đặt", update: "Sửa thông tin", reschedule: "Đổi giờ", change_tables: "Đổi / thêm / bớt bàn",
  confirm: "Xác nhận", check_in: "Khách đến", complete: "Hoàn tất", cancel: "Hủy", no_show: "Không đến",
  table_ready: "Bàn sẵn sàng", table_suspend: "Tạm ngưng bàn", table_create: "Thêm bàn", table_update: "Sửa bàn",
  lookup_save: "Danh mục", settings: "Cấu hình", profile_update: "Tài khoản", profile_create: "Tạo tài khoản",
};
