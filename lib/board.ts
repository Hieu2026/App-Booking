import { fromVn, fmtTime, minutesOf } from "./time";
import { HOLDING, type BoardTable, type Booking, type Settings } from "./types";

export type TableState = "free" | "booked" | "serving" | "cleaning" | "suspended";

export const STATE_LABEL: Record<TableState, string> = {
  free: "Trống", booked: "Có khách đặt", serving: "Đang phục vụ", cleaning: "Chờ dọn", suspended: "Tạm ngưng",
};
/** Màu thẻ bàn — luôn đi kèm chữ. Bàn có khách đặt tô đỏ. */
export const STATE_CLS: Record<TableState, string> = {
  free: "border-fresh-500 bg-fresh-50 text-fresh-900",
  booked: "border-red-600 bg-red-100 text-red-900",
  serving: "border-coral-500 bg-coral-100 text-coral-900",
  cleaning: "border-ocean-400 bg-ocean-50 text-ocean-900",
  suspended: "border-stone-400 bg-stone-200 text-stone-600",
};

export interface TableView {
  table: BoardTable;
  state: TableState;
  held: Booking[];          // lượt giữ chỗ giao với khung giờ đang xem
  dayBookings: Booking[];   // mọi lượt trong ngày (kể cả đã hủy…)
  nearest: Booking | null;  // lịch gần nhất còn hiệu lực
  serving: Booking | null;
  overrun: boolean;         // đang phục vụ nhưng đã quá giờ dự kiến
  warning: string | null;   // cảnh báo ảnh hưởng lượt kế tiếp
}

export interface Window { date: string; from: string; to: string }

export function windowRange(w: Window) {
  return { ws: new Date(fromVn(w.date, w.from)).getTime(), we: new Date(fromVn(w.date, w.to)).getTime() };
}

export function computeViews(tables: BoardTable[], bookings: Booking[], w: Window, nowIso: string, settings: Settings): TableView[] {
  const { ws, we } = windowRange(w);
  const now = new Date(nowIso).getTime();
  const buf = settings.buffer_minutes * 60000;
  const byTable = new Map<string, Booking[]>();
  for (const b of bookings) for (const t of b.tables) {
    const l = byTable.get(t.id) ?? [];
    l.push(b);
    byTable.set(t.id, l);
  }
  const dayStart = new Date(fromVn(w.date, "00:00")).getTime();
  const dayEnd = dayStart + 86400000;

  return tables.map((table) => {
    const all = (byTable.get(table.id) ?? []).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const dayBookings = all.filter((b) => new Date(b.start_at).getTime() < dayEnd && new Date(b.end_at).getTime() > dayStart);
    const holding = all.filter((b) => HOLDING.includes(b.status));
    const held = holding.filter((b) => new Date(b.start_at).getTime() < we && new Date(b.end_at).getTime() + buf > ws);
    const serving = table.ops_status === "serving" ? bookings.find((b) => b.id === table.serving_booking_id) ?? null : null;
    const overrun = !!serving && new Date(serving.end_at).getTime() < now;

    const servingRelevant = !!serving && Math.max(new Date(serving.end_at).getTime(), now) + buf > ws && now < we
      || (table.ops_status === "serving" && !serving && ws <= now && now < we);
    const cleaningRelevant = table.ops_status === "cleaning" && ws <= now && now < we;

    let state: TableState = "free";
    if (table.ops_status === "suspended") state = "suspended";
    else if (servingRelevant) state = "serving";
    else if (cleaningRelevant) state = "cleaning";
    else if (held.length > 0) state = "booked";

    const ref = Math.max(now, dayStart);
    const upcoming = holding.filter((b) => new Date(b.end_at).getTime() > ref && new Date(b.start_at).getTime() < dayEnd);
    const nearest = (w.date === new Date(now + 7 * 3600000).toISOString().slice(0, 10) ? upcoming : holding.filter((b) => new Date(b.start_at).getTime() < dayEnd && new Date(b.end_at).getTime() > dayStart))[0] ?? null;

    let warning: string | null = null;
    if (serving && overrun) {
      const next = holding.filter((b) => b.id !== serving.id && new Date(b.end_at).getTime() > now)
        .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
      if (next && new Date(next.start_at).getTime() - now < 60 * 60000) {
        warning = `Đang phục vụ quá giờ dự kiến (${fmtTime(serving.end_at)}) — lượt ${next.code} lúc ${fmtTime(next.start_at)} có thể bị ảnh hưởng.`;
      } else {
        warning = `Đang phục vụ quá giờ dự kiến (${fmtTime(serving.end_at)}).`;
      }
    }
    return { table, state, held, dayBookings, nearest, serving, overrun, warning };
  });
}

export interface Stats { free: number; booked: number; serving: number; bookings: number; guests: number }
export function computeStats(views: TableView[], bookings: Booking[]): Stats {
  const live = bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show");
  return {
    free: views.filter((v) => v.state === "free").length,
    booked: views.filter((v) => v.held.length > 0).length,
    serving: views.filter((v) => v.table.ops_status === "serving").length,
    bookings: live.length,
    guests: live.reduce((s, b) => s + b.party_size, 0),
  };
}

/** Phạm vi giờ của lịch theo giờ (làm tròn giờ), luôn gồm giờ mở cửa. */
export function timelineRange(settings: Settings, bookings: Booking[], date: string) {
  let lo = minutesOf(settings.open_time.slice(0, 5));
  let hi = minutesOf(settings.close_time.slice(0, 5));
  const dayStart = new Date(fromVn(date, "00:00")).getTime();
  for (const b of bookings) {
    lo = Math.min(lo, Math.max(0, Math.floor((new Date(b.start_at).getTime() - dayStart) / 60000)));
    hi = Math.max(hi, Math.min(24 * 60, Math.ceil((new Date(b.end_at).getTime() - dayStart) / 60000)));
  }
  return { lo: Math.floor(lo / 60) * 60, hi: Math.ceil(hi / 60) * 60, dayStart };
}
