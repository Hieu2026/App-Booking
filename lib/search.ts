import { DEFAULT_COLS, COL_BY_KEY } from "./columns";
import { addDays, todayVn } from "./time";
import type { BookingStatus } from "./types";

const STATUSES: BookingStatus[] = ["pending", "confirmed", "arrived", "completed", "cancelled", "no_show"];
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

export interface SearchParams {
  filters: Record<string, unknown>;
  sort: string; dir: "asc" | "desc"; page: number; cols: string[];
  /** giá trị thô để đổ lại vào form */
  raw: { q: string; basis: "event" | "booked"; df: string; dt: string; floor: string; table: string; consultant: string; source: string; purpose: string; status: BookingStatus[]; deposit: string };
}

export function parseSearch(sp: Record<string, string | string[] | undefined>): SearchParams {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const hasAny = ["q", "basis", "df", "dt", "floor", "table", "consultant", "source", "purpose", "status", "deposit"].some((k) => one(k) !== undefined);
  const q = (one("q") ?? "").slice(0, 100);
  const basis = one("basis") === "booked" ? "booked" : "event";
  // Lần đầu mở: xem các lượt sắp tới (7 ngày). Khi đã tìm/lọc thì không tự thêm giới hạn ngày.
  const df = hasAny ? (isDate(one("df")) ? one("df")! : "") : todayVn();
  const dt = hasAny ? (isDate(one("dt")) ? one("dt")! : "") : addDays(todayVn(), 7);
  const status = (one("status") ?? "").split(",").filter((s): s is BookingStatus => (STATUSES as string[]).includes(s));
  const raw = {
    q, basis: basis as "event" | "booked", df, dt, floor: (one("floor") ?? "").slice(0, 10),
    table: isUuid(one("table")) ? one("table")! : "", consultant: isUuid(one("consultant")) ? one("consultant")! : "",
    source: isUuid(one("source")) ? one("source")! : "", purpose: isUuid(one("purpose")) ? one("purpose")! : "",
    status, deposit: ["has", "none"].includes(one("deposit") ?? "") ? one("deposit")! : "",
  };
  const cols = (one("cols") ?? "").split(",").filter((k) => COL_BY_KEY.has(k));
  const sortKey = one("sort") ?? "start_at";
  const sortable = new Set(Array.from(COL_BY_KEY.values()).map((c) => c.sort).filter(Boolean));
  return {
    filters: {
      q: q || null, date_basis: basis, date_from: df || null, date_to: dt || null, floor: raw.floor || null,
      table_id: raw.table || null, consultant_id: raw.consultant || null, source_id: raw.source || null,
      purpose_id: raw.purpose || null, status: status.length ? status : null, deposit: raw.deposit || null,
    },
    sort: sortable.has(sortKey) ? sortKey : "start_at",
    dir: one("dir") === "desc" ? "desc" : "asc",
    page: Math.max(1, Number(one("page")) || 1),
    cols: cols.length ? cols : DEFAULT_COLS,
    raw,
  };
}

export function toQuery(p: SearchParams, over: Record<string, string | number | null> = {}) {
  const q = new URLSearchParams();
  const r = p.raw;
  const set = (k: string, v: string | number | null | undefined) => { if (v !== null && v !== undefined && v !== "") q.set(k, String(v)); };
  set("q", r.q); set("basis", r.basis); set("df", r.df); set("dt", r.dt); set("floor", r.floor); set("table", r.table);
  set("consultant", r.consultant); set("source", r.source); set("purpose", r.purpose);
  set("status", r.status.join(",")); set("deposit", r.deposit);
  set("sort", p.sort); set("dir", p.dir); set("cols", p.cols.join(","));
  for (const [k, v] of Object.entries(over)) { if (v === null) q.delete(k); else q.set(k, String(v)); }
  return q.toString();
}
