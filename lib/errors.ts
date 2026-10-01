import { fmtDateTime, fmtTime } from "./time";

export interface AppError { code: string; message: string; detail?: any }

/** Chuyển lỗi từ PostgREST/Postgres thành lỗi nghiệp vụ có mã. */
export function parseError(e: { message?: string; details?: string | null; code?: string } | null | undefined): AppError {
  const message = e?.message ?? "";
  if (/^E_[A-Z_]+$/.test(message)) {
    let detail: any;
    try { detail = e?.details ? JSON.parse(e.details) : undefined; } catch { detail = undefined; }
    return { code: message, message, detail };
  }
  if (/permission denied|JWT|not authenticated/i.test(message)) return { code: "E_FORBIDDEN", message };
  if (/fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|timeout|Failed to fetch/i.test(message)) return { code: "E_NETWORK", message };
  return { code: "E_UNKNOWN", message };
}

const who = (c: { customer_name?: string | null; event_name?: string | null }) => c.event_name || c.customer_name || "khách khác";

/** Thông báo tiếng Việt, không có thuật ngữ kỹ thuật, nói rõ cách xử lý. */
export function describeError(err: AppError): string {
  const d = err.detail ?? {};
  switch (err.code) {
    case "E_FORBIDDEN":
      return d.message ?? "Tài khoản của bạn chưa được cấp quyền hoặc đã bị khóa. Vui lòng liên hệ quản lý.";
    case "E_VALIDATION":
      return d.message ?? "Thông tin chưa hợp lệ, vui lòng kiểm tra lại.";
    case "E_OVERLAP": {
      const list: any[] = d.conflicts ?? [];
      if (!list.length) return "Bàn đã được đặt trong khung giờ này. Hãy chọn bàn hoặc giờ khác.";
      const parts = list.map((c) => `${c.table} (${c.booking_code} – ${who(c)}, ${fmtTime(c.start_at)}–${fmtTime(c.end_at)})`);
      return `Vừa có người đặt trước: ${parts.join("; ")}. Dữ liệu mới nhất đã được tải lại — hãy chọn bàn hoặc giờ khác.`;
    }
    case "E_WARNING":
      return (d.warnings ?? []).map((w: any) => w.message).join(" ") +
        (d.can_override ? " Quản lý có thể ghi đè kèm lý do." : " Chỉ quản lý được ghi đè cảnh báo này — hãy chỉnh lại hoặc nhờ quản lý.");
    case "E_VERSION":
      return `Lượt đặt này vừa được ${d.updated_by ?? "người khác"} thay đổi${d.updated_at ? ` lúc ${fmtDateTime(d.updated_at)}` : ""}. Thay đổi của bạn CHƯA được lưu. Hãy xem bản mới nhất rồi áp dụng lại.`;
    case "E_FINAL":
      return "Lượt đặt đã kết thúc (hoàn tất, đã hủy hoặc không đến) nên không thể sửa.";
    case "E_TRANSITION":
      return "Thao tác này không còn phù hợp với trạng thái hiện tại. Trang đã được tải lại, vui lòng kiểm tra rồi thử lại.";
    case "E_TABLE_BUSY": {
      const st = d.ops_status === "cleaning" ? "đang chờ dọn — hãy xác nhận “Sẵn sàng” trước"
        : d.serving_booking ? `đang phục vụ lượt ${d.serving_booking} — hãy hoàn tất lượt đó hoặc chuyển khách sang bàn khác`
        : "đang có khách";
      return `Bàn ${d.table} ${st}.`;
    }
    case "E_TABLE_SUSPENDED":
      return `Bàn ${(d.tables ?? []).join(", ")} đang tạm ngưng. Hãy mở lại bàn hoặc chọn bàn khác.`;
    case "E_NOT_FOUND":
      return "Không tìm thấy dữ liệu — có thể đã bị thay đổi. Hãy tải lại trang.";
    case "E_NETWORK":
      return "Chưa lưu được vì mất kết nối với máy chủ. Hãy kiểm tra mạng rồi bấm lưu lại — dữ liệu bạn nhập vẫn còn trên màn hình.";
    default:
      return "Có lỗi xảy ra, thông tin CHƯA được lưu. Hãy thử lại; nếu vẫn lỗi, báo quản lý.";
  }
}
