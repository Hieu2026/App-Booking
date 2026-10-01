"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, LayoutGrid, List, Plus, Rows3, Users, UserPlus } from "lucide-react";
import { useAppContext } from "./ContextProvider";
import { EmptyState, Modal, StatusChip, useRun } from "./ui";
import { computeStats, computeViews, STATE_CLS, STATE_LABEL, timelineRange, type TableState, type TableView } from "@/lib/board";
import { addDays, fmtDateLong, fmtTime, minutesOf, nowMinutes, floorTo, timeOf, todayVn } from "@/lib/time";
import { BOOKING_STATUS } from "@/lib/labels";
import { setStatusAction, setTableStatusAction } from "@/app/actions";
import type { Board, Booking } from "@/lib/types";

type View = "grid" | "list" | "timeline";

function useNow(initial: string) {
  const [now, setNow] = useState(initial);
  useEffect(() => { setNow(new Date().toISOString()); const t = setInterval(() => setNow(new Date().toISOString()), 30000); return () => clearInterval(t); }, []);
  return now;
}
const newId = () => crypto.randomUUID();

export function BoardClient({ board, date, from: fromProp, to: toProp }: { board: Board; date: string; from: string; to: string }) {
  const ctx = useAppContext();
  const router = useRouter();
  const run = useRun();
  const [from, setFrom] = useState(fromProp);
  const [to, setTo] = useState(toProp);
  const [floor, setFloor] = useState("");
  const [minCap, setMinCap] = useState(0);
  const [stateFilter, setStateFilter] = useState<"" | TableState>("");
  const [view, setView] = useState<View>("grid");
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(board.now);

  useEffect(() => { setFrom(fromProp); setTo(toProp); }, [fromProp, toProp, date]);

  const validWindow = minutesOf(to) > minutesOf(from);
  const win = { date, from, to: validWindow ? to : from };
  const views = useMemo(() => computeViews(board.tables, board.bookings, win, now, ctx.settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, from, to, date, now, ctx.settings, validWindow]);
  const stats = computeStats(views, board.bookings.filter((b) => b.start_at < addDaysIso(date, 1) && b.end_at > addDaysIso(date, 0)));

  const goto = (d: string, f = from, t = to) => router.push(`/?date=${d}&from=${f}&to=${t}`);
  const setWindow = (f: string, t: string) => {
    setFrom(f); setTo(t);
    window.history.replaceState(null, "", `/?date=${date}&from=${f}&to=${t}`);
  };
  const isToday = date === todayVn();
  const nowM = nowMinutes();
  const preset = (label: string, f: string, t: string) => (
    <button key={label} type="button" className={`btn-secondary btn-sm ${from === f && to === t ? "ring-2 ring-leaf-600" : ""}`} onClick={() => setWindow(f, t)}>{label}</button>
  );
  const nowStart = timeOf(floorTo(Math.min(Math.max(nowM, 0), 23 * 60)));
  const nowEnd = timeOf(Math.min(floorTo(nowM) + ctx.settings.default_duration_minutes, 23 * 60 + 59));

  const filtered = views.filter((v) =>
    (!floor || v.table.floor_code === floor) && v.table.capacity >= minCap && (!stateFilter || v.state === stateFilter));
  const openView = views.find((v) => v.table.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold text-leaf-900 sm:text-2xl">Bàn {isToday ? "hôm nay" : "ngày"} · {fmtDateLong(date)}</h1>
        <Link href={`/dat-ban/moi?date=${date}&from=${from}&to=${to}`} className="btn-secondary"><Plus size={18} aria-hidden /> Đặt cho khung giờ đang xem</Link>
        <Link href="/dat-ban/moi?walkin=1" className="btn-secondary"><UserPlus size={18} aria-hidden /> Khách vãng lai</Link>
      </div>

      {/* Chọn ngày & khung giờ */}
      <section className="card flex flex-wrap items-end gap-3" aria-label="Chọn ngày và khung giờ">
        <div>
          <span className="label">Ngày</span>
          <div className="flex items-center gap-1">
            <button className="btn-secondary px-2" aria-label="Ngày trước" onClick={() => goto(addDays(date, -1))}><ChevronLeft size={20} /></button>
            <input type="date" className="input w-auto" value={date} onChange={(e) => e.target.value && goto(e.target.value)} aria-label="Ngày xem" />
            <button className="btn-secondary px-2" aria-label="Ngày sau" onClick={() => goto(addDays(date, 1))}><ChevronRight size={20} /></button>
            {!isToday && <button className="btn-ghost btn-sm" onClick={() => goto(todayVn())}>Hôm nay</button>}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="from">Từ giờ</label>
          <input id="from" type="time" step={900} className="input w-36" value={from} onChange={(e) => e.target.value && setWindow(e.target.value, to)} />
        </div>
        <div>
          <label className="label" htmlFor="to">Đến giờ</label>
          <input id="to" type="time" step={900} className="input w-36" value={to} onChange={(e) => e.target.value && setWindow(from, e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isToday && preset("Bây giờ", nowStart, nowEnd)}
          {preset("Cả ngày", ctx.settings.open_time.slice(0, 5), ctx.settings.close_time.slice(0, 5))}
          {preset("Trưa 11–14", "11:00", "14:00")}
          {preset("Tối 17–21", "17:00", "21:00")}
        </div>
        {!validWindow && <p role="alert" className="w-full text-sm font-semibold text-red-700">Giờ kết thúc phải sau giờ bắt đầu.</p>}
      </section>

      {/* Thống kê */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Thống kê">
        <Stat label="Bàn trống" sub={`trong ${from}–${to}`} value={stats.free} cls="text-fresh-700" />
        <Stat label="Bàn có lịch" sub={`trong ${from}–${to}`} value={stats.booked} cls="text-red-700" />
        <Stat label="Đang phục vụ" sub="hiện tại" value={stats.serving} cls="text-coral-700" />
        <Stat label="Lượt đặt trong ngày" sub="không tính đã hủy / không đến" value={stats.bookings} cls="text-leaf-800" />
        <Stat label="Khách dự kiến" sub="tổng số khách trong ngày" value={stats.guests} cls="text-leaf-800" />
      </section>

      {/* Bộ lọc & chế độ xem */}
      <section className="flex flex-wrap items-end gap-3">
        <div className="inline-flex overflow-hidden rounded-xl border border-stone-300 bg-white" role="tablist" aria-label="Chế độ xem">
          {([["grid", "Lưới bàn", LayoutGrid], ["list", "Danh sách đặt bàn", List], ["timeline", "Lịch theo giờ", Rows3]] as const).map(([k, label, Icon]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`flex min-h-11 items-center gap-2 px-3 text-sm font-semibold ${view === k ? "bg-leaf-700 text-white" : "hover:bg-cream-100"}`}>
              <Icon size={18} aria-hidden /> {label}
            </button>
          ))}
        </div>
        {view !== "list" && <>
          <div>
            <label className="label" htmlFor="f-floor">Tầng</label>
            <select id="f-floor" className="input w-40" value={floor} onChange={(e) => setFloor(e.target.value)}>
              <option value="">Tất cả</option>
              {ctx.floors.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-cap">Sức chứa</label>
            <select id="f-cap" className="input w-40" value={minCap} onChange={(e) => setMinCap(Number(e.target.value))}>
              <option value={0}>Tất cả</option>
              {[4, 6, 8, 10, 15, 30].map((n) => <option key={n} value={n}>Từ {n} chỗ trở lên</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-state">Trạng thái</label>
            <select id="f-state" className="input w-44" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as any)}>
              <option value="">Tất cả</option>
              {(Object.keys(STATE_LABEL) as TableState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
            </select>
          </div>
        </>}
        <Legend />
      </section>

      {view === "grid" && <GridView views={filtered} onOpen={setOpenId} />}
      {view === "list" && <ListView bookings={board.bookings.filter((b) => b.start_at < addDaysIso(date, 1) && b.end_at > addDaysIso(date, 0))} date={date} />}
      {view === "timeline" && <Timeline views={filtered} date={date} now={now} />}

      <TableDrawer view={openView} date={date} from={from} to={to} onClose={() => setOpenId(null)} run={run} />
    </div>
  );
  function addDaysIso(d: string, n: number) { return new Date(new Date(`${addDays(d, n)}T00:00:00+07:00`)).toISOString(); }
}

function Stat({ label, sub, value, cls }: { label: string; sub: string; value: number; cls: string }) {
  return (
    <div className="card !p-3">
      <div className="text-sm font-semibold text-stone-600">{label}</div>
      <div className={`text-3xl font-extrabold ${cls}`}>{value}</div>
      <div className="text-xs text-stone-500">{sub}</div>
    </div>
  );
}

function Legend() {
  return (
    <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600" aria-label="Chú giải màu">
      {(Object.keys(STATE_LABEL) as TableState[]).map((s) => (
        <li key={s} className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded border-2 ${STATE_CLS[s]}`} />{STATE_LABEL[s]}</li>
      ))}
    </ul>
  );
}

function GridView({ views, onOpen }: { views: TableView[]; onOpen: (id: string) => void }) {
  const ctx = useAppContext();
  if (!views.length) return <EmptyState title="Không có bàn nào khớp bộ lọc" hint="Thử bỏ bớt bộ lọc tầng, sức chứa hoặc trạng thái." />;
  return (
    <div className="space-y-5">
      <p className="text-xs text-stone-500">Đây là danh sách bàn trực quan theo tầng, không phải bản vẽ mặt bằng.</p>
      {ctx.floors.map((f) => {
        const list = views.filter((v) => v.table.floor_code === f.code);
        if (!list.length) return null;
        const free = list.filter((v) => v.state === "free").length;
        return (
          <section key={f.code} aria-label={f.name}>
            <h2 className="mb-2 flex items-baseline gap-2 text-lg font-bold text-leaf-900">
              {f.name}
              <span className="text-sm font-normal text-stone-500">{list.length} bàn · {list.reduce((s, v) => s + v.table.capacity, 0)} chỗ · {free} trống</span>
            </h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {list.map((v) => <TableCard key={v.table.id} v={v} onOpen={() => onOpen(v.table.id)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TableCard({ v, onOpen }: { v: TableView; onOpen: () => void }) {
  const b = v.nearest;
  return (
    <button onClick={onOpen} data-testid={`table-${v.table.code}`} data-state={v.state}
      className={`flex min-h-28 flex-col rounded-2xl border-2 p-3 text-left shadow-sm transition hover:shadow-md ${STATE_CLS[v.state]}`}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-xl font-extrabold leading-tight">{v.table.code}</span>
        <span className="flex items-center gap-1 text-sm font-semibold"><Users size={15} aria-hidden />{v.table.capacity}</span>
      </div>
      <span className="mt-0.5 text-sm font-bold">{STATE_LABEL[v.state]}{v.overrun && " · quá giờ"}</span>
      {b ? (
        <span className="mt-1 text-xs leading-snug">
          <CalendarClock size={12} className="mr-1 inline" aria-hidden />{fmtTime(b.start_at)}–{fmtTime(b.end_at)} · {b.event_name || b.customer_name || "Khách vãng lai"} · {b.party_size} khách
        </span>
      ) : <span className="mt-1 text-xs opacity-70">Không còn lịch</span>}
      {v.warning && <span className="mt-1 flex items-start gap-1 text-xs font-semibold text-red-800"><AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />{v.warning}</span>}
    </button>
  );
}

const NEXT_ACTION: Record<string, { action: string; label: string; ok: string } | undefined> = {
  pending: { action: "confirm", label: "Xác nhận", ok: "Đã xác nhận lượt đặt." },
  confirmed: { action: "check_in", label: "Khách đến", ok: "Đã ghi nhận khách đến, bàn chuyển sang đang phục vụ." },
  arrived: { action: "complete", label: "Hoàn tất", ok: "Đã hoàn tất — bàn chuyển sang chờ dọn." },
};

function ListView({ bookings, date }: { bookings: Booking[]; date: string }) {
  const run = useRun();
  const [busy, setBusy] = useState<string | null>(null);
  if (!bookings.length) return <EmptyState title="Chưa có lượt đặt nào trong ngày này" hint="Bấm “Đặt bàn mới” để thêm lượt đặt đầu tiên." />;
  return (
    <div className="card overflow-x-auto !p-0" aria-label={`Danh sách đặt bàn ngày ${date}`}>
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-cream-100"><tr>
          <th className="th">Giờ</th><th className="th">Mã</th><th className="th">Khách / Tiệc</th><th className="th">Bàn</th>
          <th className="th">Khách</th><th className="th">Trạng thái</th><th className="th" />
        </tr></thead>
        <tbody className="divide-y divide-cream-200">
          {bookings.map((b) => {
            const na = NEXT_ACTION[b.status];
            return (
              <tr key={b.id} className={b.status === "cancelled" || b.status === "no_show" ? "opacity-60" : ""}>
                <td className="td whitespace-nowrap font-semibold">{fmtTime(b.start_at)}–{fmtTime(b.end_at)}</td>
                <td className="td whitespace-nowrap"><Link href={`/dat-ban/${b.id}`} className="font-semibold text-leaf-700 underline">{b.code}</Link></td>
                <td className="td">
                  <div className="font-semibold">{b.customer_name || "Khách vãng lai"}</div>
                  <div className="text-xs text-stone-500">{[b.event_name, b.customer_phone].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="td">{b.tables.map((t) => t.code).join(", ")}</td>
                <td className="td">{b.party_size}{b.children_count ? <span className="text-xs text-stone-500"> (trẻ em {b.children_count})</span> : null}</td>
                <td className="td"><StatusChip status={b.status} /></td>
                <td className="td text-right">
                  {na && (
                    <button className="btn-secondary btn-sm" disabled={busy === b.id} onClick={async () => {
                      setBusy(b.id);
                      await run(() => setStatusAction({ requestId: newId(), id: b.id, version: b.version, action: na.action }), na.ok);
                      setBusy(null);
                    }}>{na.label}</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ views, date, now }: { views: TableView[]; date: string; now: string }) {
  const ctx = useAppContext();
  const allB = useMemo(() => Array.from(new Map(views.flatMap((v) => v.dayBookings).map((b) => [b.id, b])).values()), [views]);
  const { lo, hi, dayStart } = timelineRange(ctx.settings, allB.filter((b) => b.status !== "cancelled"), date);
  const span = hi - lo;
  const hours = Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => lo / 60 + i);
  const nowPct = ((new Date(now).getTime() - dayStart) / 60000 - lo) / span * 100;
  if (!views.length) return <EmptyState title="Không có bàn nào khớp bộ lọc" />;
  return (
    <div className="card overflow-x-auto !p-0">
      <div className="min-w-[900px]">
        <div className="sticky top-0 flex border-b border-cream-300 bg-cream-100 text-xs font-semibold text-stone-600">
          <div className="w-24 shrink-0 px-2 py-2">Bàn</div>
          <div className="relative h-8 flex-1">
            {hours.map((h) => <span key={h} className="absolute top-2 -translate-x-1/2" style={{ left: `${((h * 60 - lo) / span) * 100}%` }}>{h}:00</span>)}
          </div>
        </div>
        {views.map((v) => (
          <div key={v.table.id} className="flex border-b border-cream-200">
            <div className="w-24 shrink-0 px-2 py-2 text-sm font-bold">{v.table.code}<span className="ml-1 text-xs font-normal text-stone-500">{v.table.capacity}</span></div>
            <div className="relative h-11 flex-1">
              {hours.map((h) => <span key={h} className="absolute inset-y-0 border-l border-cream-200" style={{ left: `${((h * 60 - lo) / span) * 100}%` }} />)}
              {v.dayBookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show").map((b) => {
                const s = Math.max((new Date(b.start_at).getTime() - dayStart) / 60000, lo);
                const e = Math.min((new Date(b.end_at).getTime() - dayStart) / 60000, hi);
                return (
                  <Link key={b.id} href={`/dat-ban/${b.id}`} title={`${b.code} · ${b.customer_name ?? "Khách vãng lai"} · ${BOOKING_STATUS[b.status].label}`}
                    className={`absolute inset-y-1 overflow-hidden rounded-md border px-1.5 text-xs font-semibold leading-tight ${b.status === "completed" ? "border-stone-300 bg-stone-200 text-stone-700" : b.status === "arrived" ? "border-coral-500 bg-coral-100 text-coral-900" : "border-red-600 bg-red-100 text-red-900"}`}
                    style={{ left: `${((s - lo) / span) * 100}%`, width: `${((e - s) / span) * 100}%` }}>
                    {fmtTime(b.start_at)} {b.customer_name ?? "Vãng lai"}
                  </Link>
                );
              })}
              {nowPct >= 0 && nowPct <= 100 && date === todayVn() && <span className="absolute inset-y-0 w-0.5 bg-clay-500" style={{ left: `${nowPct}%` }} aria-hidden />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableDrawer({ view, date, from, to, onClose, run }: {
  view: TableView | null; date: string; from: string; to: string; onClose: () => void; run: ReturnType<typeof useRun>;
}) {
  const [busy, setBusy] = useState(false);
  if (!view) return null;
  const t = view.table;
  const setOps = async (status: "ready" | "suspended") => {
    setBusy(true);
    const r = await run(() => setTableStatusAction({ tableId: t.id, status }),
      status === "ready" ? `Bàn ${t.code} đã sẵn sàng.` : `Đã tạm ngưng bàn ${t.code}.`);
    setBusy(false);
    if (r?.ok && (r.data as any)?.upcoming_bookings > 0 && status === "suspended")
      alert(`Lưu ý: bàn ${t.code} còn ${(r.data as any).upcoming_bookings} lượt đặt sắp tới. Hãy chuyển các lượt này sang bàn khác.`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Bàn ${t.code} · ${t.capacity} chỗ`} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`chip ring-0 border-2 ${STATE_CLS[view.state]}`}>{STATE_LABEL[view.state]}</span>
        <span className="text-sm text-stone-600">Vận hành: <b>{{ ready: "Sẵn sàng", serving: "Đang phục vụ", cleaning: "Chờ dọn", suspended: "Tạm ngưng" }[t.ops_status]}</b></span>
      </div>
      {view.warning && <p role="alert" className="mb-3 flex gap-2 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800"><AlertTriangle size={18} className="shrink-0" aria-hidden />{view.warning}</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        <Link className="btn-accent" href={`/dat-ban/moi?date=${date}&from=${from}&to=${to}&table=${t.id}`}><Plus size={18} aria-hidden /> Tạo lượt đặt cho bàn này</Link>
        {t.ops_status === "cleaning" && <button className="btn-primary" disabled={busy} onClick={() => setOps("ready")}>Xác nhận sẵn sàng</button>}
        {t.ops_status === "suspended" && <button className="btn-primary" disabled={busy} onClick={() => setOps("ready")}>Mở lại bàn</button>}
        {(t.ops_status === "ready" || t.ops_status === "cleaning") && (
          <button className="btn-secondary" disabled={busy} onClick={() => confirm(`Tạm ngưng bàn ${t.code}? Bàn sẽ không nhận lượt đặt mới.`) && setOps("suspended")}>Tạm ngưng bàn</button>
        )}
      </div>
      <h3 className="mb-2 font-bold">Lịch trong ngày {fmtDateLong(date)}</h3>
      {view.dayBookings.length === 0 ? <EmptyState title="Bàn chưa có lượt đặt nào trong ngày" /> : (
        <ul className="space-y-2">
          {view.dayBookings.map((b) => (
            <li key={b.id}>
              <Link href={`/dat-ban/${b.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-cream-300 p-3 hover:bg-cream-50">
                <span className="font-bold">{fmtTime(b.start_at)}–{fmtTime(b.end_at)}</span>
                <span className="font-semibold">{b.customer_name || "Khách vãng lai"}</span>
                <span className="text-sm text-stone-600">{b.party_size} khách{b.event_name ? ` · ${b.event_name}` : ""}</span>
                <span className="ml-auto"><StatusChip status={b.status} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
