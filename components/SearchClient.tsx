"use client";
import { DateInput } from "./DateTimeInputs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Search } from "lucide-react";
import { COLUMNS, COL_BY_KEY, display } from "@/lib/columns";
import { toQuery, type SearchParams } from "@/lib/search";
import { STATUS_ORDER, BOOKING_STATUS } from "@/lib/labels";
import { EmptyState, StatusChip } from "./ui";
import { fmtMoney } from "@/lib/time";
import type { Booking, BookingStatus, Floor, Lookup, StaffRef } from "@/lib/types";

interface Result { total: number; total_guests: number; total_deposit: string | number; rows: Booking[] }
const COLS_KEY = "khoai.cols";

export function SearchClient({ params, result, pageSize, floors, staff, lookups }: {
  params: SearchParams; result: Result; pageSize: number; floors: Floor[]; staff: StaffRef[]; lookups: Lookup[];
}) {
  const router = useRouter();
  const r = params.raw;
  const [q, setQ] = useState(r.q);
  const [basis, setBasis] = useState(r.basis);
  const [df, setDf] = useState(r.df);
  const [dt, setDt] = useState(r.dt);
  const [floor, setFloor] = useState(r.floor);
  const [consultant, setConsultant] = useState(r.consultant);
  const [source, setSource] = useState(r.source);
  const [purpose, setPurpose] = useState(r.purpose);
  const [status, setStatus] = useState<BookingStatus[]>(r.status);
  const [deposit, setDeposit] = useState(r.deposit);
  const [colsOpen, setColsOpen] = useState(false);
  const [cols, setCols] = useState(params.cols);

  useEffect(() => { setCols(params.cols); }, [params.cols]);
  // Tiện ích cá nhân: nhớ bộ cột đã chọn gần nhất trên máy này (không phải dữ liệu nghiệp vụ).
  useEffect(() => {
    try {
      const has = new URLSearchParams(window.location.search).has("cols");
      const saved = localStorage.getItem(COLS_KEY);
      if (!has && saved) { const next = saved.split(",").filter((k) => COL_BY_KEY.has(k)); if (next.length) router.replace(`/dat-ban?${toQuery({ ...params, cols: next })}`); }
    } catch { /* trình duyệt chặn lưu trữ: bỏ qua */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = (): SearchParams => ({
    ...params, cols,
    raw: { q, basis, df, dt, floor, table: r.table, consultant, source, purpose, status, deposit },
  });
  const go = (over: Record<string, string | number | null> = {}, p = current()) => router.push(`/dat-ban?${toQuery(p, { page: 1, ...over })}`);
  const exportHref = `/api/export?${toQuery(current(), { page: null })}`;
  const pages = Math.max(1, Math.ceil(result.total / pageSize));

  const toggleCol = (k: string) => {
    const next = cols.includes(k) ? cols.filter((x) => x !== k) : [...cols, k];
    if (!next.length) return;
    const ordered = COLUMNS.map((c) => c.key).filter((x) => next.includes(x));
    setCols(ordered);
    try { localStorage.setItem(COLS_KEY, ordered.join(",")); } catch { /* bỏ qua */ }
    router.replace(`/dat-ban?${toQuery({ ...params, cols: ordered }, { page: params.page })}`);
  };

  const sortLink = (key: string) => {
    const dir = params.sort === key && params.dir === "asc" ? "desc" : "asc";
    return `/dat-ban?${toQuery(params, { sort: key, dir, page: 1 })}`;
  };
  const shown = cols.map((k) => COL_BY_KEY.get(k)!).filter(Boolean);
  const lk = (kind: string) => lookups.filter((l) => l.kind === kind);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-leaf-900 sm:text-2xl">Danh sách đặt bàn &amp; báo cáo</h1>

      <form className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); go(); }} aria-label="Bộ lọc">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="q">Tìm kiếm</label>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-3 top-3 text-stone-400" aria-hidden />
            <input id="q" className="input pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên khách, số điện thoại, mã đặt chỗ, tên tiệc, mã bàn, Mã HĐ" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="basis">Tính ngày theo</label>
          <select id="basis" className="input" value={basis} onChange={(e) => setBasis(e.target.value as any)}>
            <option value="event">Ngày diễn ra tiệc</option>
            <option value="booked">Ngày khách đặt bàn / đặt tiệc</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="df">Từ ngày</label><DateInput id="df" className="" value={df} onChange={(v) => setDf(v)} /></div>
          <div><label className="label" htmlFor="dt">Đến ngày</label><DateInput id="dt" className="" value={dt} onChange={(v) => setDt(v)} /></div>
        </div>
        <div>
          <label className="label" htmlFor="floor">Tầng</label>
          <select id="floor" className="input" value={floor} onChange={(e) => setFloor(e.target.value)}>
            <option value="">Tất cả</option>{floors.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="consultant">Nhân viên tư vấn</label>
          <select id="consultant" className="input" value={consultant} onChange={(e) => setConsultant(e.target.value)}>
            <option value="">Tất cả</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="source">Nguồn khách</label>
          <select id="source" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Tất cả</option>{lk("source").map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="purpose">Mục đích tiệc</label>
          <select id="purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="">Tất cả</option>{lk("purpose").map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="deposit">Tình trạng cọc</label>
          <select id="deposit" className="input" value={deposit} onChange={(e) => setDeposit(e.target.value)}>
            <option value="">Tất cả</option><option value="has">Đã cọc</option><option value="none">Chưa cọc</option>
          </select>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="label">Trạng thái</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {STATUS_ORDER.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={status.includes(s)} onChange={() => setStatus(status.includes(s) ? status.filter((x) => x !== s) : [...status, s])} />
                {BOOKING_STATUS[s].label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="btn-primary"><Search size={18} aria-hidden /> Tìm / lọc</button>
          <button type="button" className="btn-secondary" onClick={() => { setQ(""); setDf(""); setDt(""); setFloor(""); setConsultant(""); setSource(""); setPurpose(""); setStatus([]); setDeposit(""); router.push(`/dat-ban?basis=event`); }}>Xóa bộ lọc</button>
          <button type="button" className="btn-secondary" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}><Columns3 size={18} aria-hidden /> Chọn cột</button>
          <a className="btn-accent ml-auto" href={exportHref} download><Download size={18} aria-hidden /> Xuất Excel (.xlsx)</a>
        </div>
        {colsOpen && (
          <div className="rounded-xl border border-cream-300 bg-cream-50 p-3 sm:col-span-2 lg:col-span-4">
            <p className="mb-2 text-sm font-semibold">Cột hiển thị &amp; xuất Excel</p>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
              {COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} />
                  {c.label}{!c.sort && <span className="text-xs text-stone-400"> (không sắp xếp)</span>}
                </label>
              ))}
            </div>
            <p className="hint">Các cột có ghi “không sắp xếp” (bàn, món yêu cầu, ghi chú tự do…) chỉ xem và xuất Excel, không sắp xếp được. File Excel luôn có thêm “Mã đặt chỗ” và các sheet “Chi tiết bàn”, “Món yêu cầu”.</p>
          </div>
        )}
      </form>

      <div data-testid="totals" className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-leaf-50 px-4 py-2 text-sm" aria-live="polite">
        <span><b>{result.total}</b> lượt đặt</span>
        <span><b>{result.total_guests}</b> khách (tổng số người, đã gồm trẻ em)</span>
        <span>Tiền cọc: <b>{fmtMoney(result.total_deposit)}</b> <span className="text-stone-500">(chỉ để theo dõi, mỗi lượt tính một lần)</span></span>
      </div>

      {result.rows.length === 0 ? (
        <EmptyState title="Không có lượt đặt nào khớp" hint="Thử mở rộng khoảng ngày hoặc bỏ bớt bộ lọc." />
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[720px]">
            <thead className="bg-cream-100">
              <tr>
                {shown.map((c) => (
                  <th key={c.key} className="th" aria-sort={c.sort && params.sort === c.sort ? (params.dir === "asc" ? "ascending" : "descending") : undefined}>
                    {c.sort ? (
                      <Link href={sortLink(c.sort)} className="inline-flex items-center gap-1 hover:text-leaf-800">
                        {c.label}
                        {params.sort === c.sort ? (params.dir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={13} className="opacity-40" />}
                      </Link>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-200">
              {result.rows.map((b) => (
                <tr key={b.id} className="hover:bg-cream-50">
                  {shown.map((c) => (
                    <td key={c.key} className={`td ${c.kind === "money" || c.kind === "int" ? "text-right" : ""}`}>
                      {c.key === "code" ? <Link className="font-semibold text-leaf-700 underline" href={`/dat-ban/${b.id}`}>{b.code}</Link>
                        : c.key === "status" ? <StatusChip status={b.status} />
                        : <span className={c.key === "special_requests" || c.key === "items" ? "line-clamp-2 max-w-xs" : ""}>{display(c, b)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Phân trang">
          <button className="btn-secondary" disabled={params.page <= 1} onClick={() => router.push(`/dat-ban?${toQuery(params, { page: params.page - 1 })}`)}>← Trước</button>
          <span className="text-sm">Trang {params.page} / {pages}</span>
          <button className="btn-secondary" disabled={params.page >= pages} onClick={() => router.push(`/dat-ban?${toQuery(params, { page: params.page + 1 })}`)}>Sau →</button>
        </nav>
      )}
    </div>
  );
}
