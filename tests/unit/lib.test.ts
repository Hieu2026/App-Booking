import { describe, expect, it } from "vitest";
import { addDays, fmtDateTime, fromVn, todayVn, vnParts, wallDate } from "@/lib/time";
import { computeStats, computeViews } from "@/lib/board";
import { safeText } from "@/lib/export";
import { describeError } from "@/lib/errors";
import { parseSearch } from "@/lib/search";
import type { BoardTable, Booking, Settings } from "@/lib/types";

const settings: Settings = { open_time: "10:00:00", close_time: "22:00:00", buffer_minutes: 0, default_duration_minutes: 120 };
const T = (code: string, over: Partial<BoardTable> = {}): BoardTable => ({
  id: code, code, floor_code: "T1", capacity: 4, ops_status: "ready", active: true, note: null, serving_booking_id: null, serving_booking_code: null, ...over,
});
const B = (id: string, tables: string[], start: string, end: string, status: Booking["status"] = "confirmed"): Booking => ({
  id, code: `KH-${id}`, status, is_walk_in: false, is_demo: false, consultant_id: null, consultant_option_id: null, consultant_name: null, event_name: null, customer_name: "Khách " + id,
  customer_phone: "0900000000", source_id: null, source_label: null, purpose_id: null, purpose_label: null, start_at: start, end_at: end, booked_at: null,
  party_size: 4, children_count: 0, decoration: null, special_requests: null, deposit_amount: null, deposit_method_id: null, deposit_method_label: null,
  deposit_date: null, contract_code: null, cancel_reason: null, change_note: null, override_reason: null, version: 1, created_at: start, created_by_name: null,
  updated_at: start, updated_by_name: null, tables: tables.map((c) => ({ id: c, code: c, floor_code: "T1", capacity: 4 })), items: [],
});

describe("thời gian (múi giờ Việt Nam)", () => {
  it("chuyển đổi hai chiều và hiển thị theo giờ VN", () => {
    const iso = fromVn("2030-05-04", "18:30");
    expect(iso).toBe("2030-05-04T11:30:00.000Z");
    expect(vnParts(iso)).toMatchObject({ date: "2030-05-04", time: "18:30" });
    expect(fmtDateTime(iso)).toBe("18:30 04/05/2030");
    expect(todayVn(new Date("2030-05-04T20:00:00Z"))).toBe("2030-05-05"); // 03:00 sáng hôm sau theo giờ VN
    expect(addDays("2030-02-28", 1)).toBe("2030-03-01");
    expect(wallDate(iso).toISOString()).toBe("2030-05-04T18:30:00.000Z");
  });
});

describe("trạng thái bàn theo ngày và khung giờ", () => {
  const day = "2030-05-04";
  const now = fromVn(day, "13:00");
  const w = (from: string, to: string) => ({ date: day, from, to });
  const bookings = [B("1", ["A1"], fromVn(day, "18:00"), fromVn(day, "20:00")), B("2", ["A2"], fromVn(day, "12:00"), fromVn(day, "14:00"), "cancelled")];
  const tables = [T("A1"), T("A2"), T("A3")];

  it("trống / có lịch tùy khung giờ; liền kề không tính trùng; đã hủy không giữ chỗ", () => {
    const v = (a: string, b: string) => Object.fromEntries(computeViews(tables, bookings, w(a, b), now, settings).map((x) => [x.table.code, x.state]));
    expect(v("10:00", "22:00")).toEqual({ A1: "booked", A2: "free", A3: "free" });
    expect(v("10:00", "18:00")).toEqual({ A1: "free", A2: "free", A3: "free" });
    expect(v("20:00", "22:00").A1).toBe("free");
    expect(v("19:59", "22:00").A1).toBe("booked");
  });

  it("đang phục vụ quá giờ vẫn là 'đang phục vụ' và cảnh báo lượt kế tiếp", () => {
    const serving = B("3", ["A3"], fromVn(day, "11:00"), fromVn(day, "12:30"), "arrived");
    const next = B("4", ["A3"], fromVn(day, "13:30"), fromVn(day, "15:00"));
    const ts = [T("A3", { ops_status: "serving", serving_booking_id: "3" })];
    const [view] = computeViews(ts, [serving, next], w("10:00", "22:00"), now, settings);
    expect(view.state).toBe("serving");
    expect(view.overrun).toBe(true);
    expect(view.warning).toContain("KH-4");
    // xem một ngày khác: trạng thái vận hành hiện tại không ảnh hưởng
    const [other] = computeViews(ts, [], { date: "2030-05-06", from: "10:00", to: "22:00" }, now, settings);
    expect(other.state).toBe("free");
  });

  it("bàn tạm ngưng / chờ dọn / thống kê", () => {
    const ts = [T("A1", { ops_status: "suspended" }), T("A2", { ops_status: "cleaning" }), T("A3")];
    const views = computeViews(ts, bookings, w("10:00", "22:00"), now, settings);
    expect(views.map((x) => x.state)).toEqual(["suspended", "cleaning", "free"]);
    const s = computeStats(views, bookings);
    expect(s).toMatchObject({ free: 1, bookings: 1, guests: 4 });
  });

  it("khoảng đệm dọn bàn được tính khi kiểm tra khả dụng", () => {
    const [v] = computeViews([T("A1")], bookings, w("20:00", "22:00"), now, { ...settings, buffer_minutes: 15 });
    expect(v.state).toBe("booked");
  });
});

describe("báo cáo & lỗi", () => {
  it("vô hiệu hóa chuỗi có thể thành công thức", () => {
    for (const s of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\t=x", "\r=x"]) expect(safeText(s).startsWith("'")).toBe(true);
    expect(safeText("Nguyễn Văn A")).toBe("Nguyễn Văn A");
    expect(safeText(null)).toBe("");
  });
  it("thông báo lỗi tiếng Việt, không lộ thuật ngữ kỹ thuật", () => {
    const m = describeError({ code: "E_OVERLAP", message: "E_OVERLAP", detail: { conflicts: [{ table: "A1", booking_code: "KH-00001", customer_name: "An", start_at: fromVn("2030-05-04", "18:00"), end_at: fromVn("2030-05-04", "20:00") }] } });
    expect(m).toContain("A1"); expect(m).toContain("18:00–20:00"); expect(m).not.toMatch(/E_|SQL|exception/i);
    expect(describeError({ code: "E_NETWORK", message: "" })).toContain("Chưa lưu");
    expect(describeError({ code: "E_UNKNOWN", message: "relation x does not exist" })).not.toContain("relation");
  });
  it("tham số tìm kiếm: mặc định 7 ngày tới, cột và sắp xếp được kiểm tra", () => {
    const d = parseSearch({});
    expect(d.raw.df).toBe(todayVn()); expect(d.cols).toContain("code");
    const p = parseSearch({ sort: "1; drop table x", cols: "code,khong_co,tables", status: "pending,evil", basis: "booked", df: "2030-01-01" });
    expect(p.sort).toBe("start_at"); expect(p.cols).toEqual(["code", "tables"]); expect(p.raw.status).toEqual(["pending"]); expect(p.raw.dt).toBe("");
  });
});
