"use client";
import { TimeInput } from "./DateTimeInputs";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAppContext } from "./ContextProvider";
import { EmptyState, Field, Modal, useRun } from "./ui";
import { createStaffAction, resetPasswordAction, saveLookupAction, saveSettingsAction, saveTableAction, setProfileAction } from "@/app/actions";
import { ACTION_LABEL, TABLE_OPS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/time";
import { floorStyle } from "@/lib/board";
import type { Floor, Lookup, Settings } from "@/lib/types";

export function AdminTabs() {
  const path = usePathname();
  const tabs = [["tai-khoan", "Tài khoản"], ["ban", "Danh mục bàn"], ["danh-muc", "Nguồn khách, mục đích, phương thức cọc"], ["cau-hinh", "Cấu hình"], ["nhat-ky", "Nhật ký"]];
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-cream-300" aria-label="Mục quản lý">
      {tabs.map(([k, label]) => (
        <Link key={k} href={`/quan-ly/${k}`} aria-current={path.endsWith(k) ? "page" : undefined}
          className={`shrink-0 rounded-t-lg px-4 py-2 text-sm font-semibold ${path.endsWith(k) ? "bg-white text-leaf-800 ring-1 ring-cream-300" : "text-stone-600 hover:bg-cream-100"}`}>{label}</Link>
      ))}
    </nav>
  );
}

// ------------------------------------------------------------------ tài khoản
interface Profile { id: string; full_name: string; email: string | null; role: "manager" | "receptionist"; active: boolean }
export function AccountsAdmin({ profiles }: { profiles: Profile[] }) {
  const run = useRun();
  const ctx = useAppContext();
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<Profile | null>(null);
  const [f, setF] = useState({ email: "", name: "", role: "receptionist" as Profile["role"], password: "" });
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-stone-600">Mỗi nhân viên một tài khoản riêng. Khóa tài khoản khi nhân viên nghỉ việc (dữ liệu và lịch sử vẫn được giữ).</p>
        <button className="btn-primary ml-auto" onClick={() => { setF({ email: "", name: "", role: "receptionist", password: "" }); setCreate(true); }}>+ Tạo tài khoản</button>
      </div>
      <div className="card overflow-x-auto !p-0">
        <table className="w-full min-w-[640px]">
          <thead className="bg-cream-100"><tr><th className="th">Họ tên</th><th className="th">Email</th><th className="th">Vai trò</th><th className="th">Tình trạng</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-cream-200">
            {profiles.map((p) => (
              <tr key={p.id}>
                <td className="td font-semibold">{p.full_name}{p.id === ctx.me.id && <span className="text-xs text-stone-500"> (bạn)</span>}</td>
                <td className="td">{p.email}</td>
                <td className="td">{p.role === "manager" ? "Quản lý" : "Lễ tân / Sales"}</td>
                <td className="td">{p.active ? <span className="chip bg-fresh-100 text-fresh-900 ring-fresh-300">Đang hoạt động</span> : <span className="chip bg-stone-200 text-stone-600 ring-stone-300">Đã khóa</span>}</td>
                <td className="td text-right"><button className="btn-secondary btn-sm" onClick={() => { setEdit(p); setPw(""); }}>Sửa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={create} onClose={() => setCreate(false)} title="Tạo tài khoản nhân viên">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          const r = await run(() => createStaffAction(f), "Đã tạo tài khoản.");
          setBusy(false); if (r?.ok) setCreate(false);
        }}>
          <Field label="Họ tên" htmlFor="n" required><input id="n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Email đăng nhập" htmlFor="e" required><input id="e" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <Field label="Vai trò" htmlFor="r">
            <select id="r" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as any })}>
              <option value="receptionist">Lễ tân / Sales</option><option value="manager">Quản lý</option>
            </select>
          </Field>
          <Field label="Mật khẩu tạm (tối thiểu 10 ký tự)" htmlFor="p" required hint="Đưa mật khẩu này cho nhân viên và nhờ đổi sau lần đăng nhập đầu.">
            <input id="p" className="input" value={f.password} minLength={10} onChange={(e) => setF({ ...f, password: e.target.value })} required autoComplete="off" />
          </Field>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setCreate(false)}>Hủy</button><button className="btn-primary" disabled={busy}>{busy ? "Đang tạo…" : "Tạo tài khoản"}</button></div>
        </form>
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Sửa tài khoản: ${edit?.full_name ?? ""}`}>
        {edit && (
          <div className="space-y-3">
            <Field label="Họ tên" htmlFor="en"><input id="en" className="input" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="Vai trò" htmlFor="er">
              <select id="er" className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as any })}>
                <option value="receptionist">Lễ tân / Sales</option><option value="manager">Quản lý</option>
              </select>
            </Field>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Đang hoạt động (bỏ chọn để khóa tài khoản)</label>
            <div className="flex justify-end gap-2">
              <button className="btn-primary" disabled={busy} onClick={async () => {
                setBusy(true);
                const r = await run(() => setProfileAction({ id: edit.id, name: edit.full_name, role: edit.role, active: edit.active }), "Đã lưu tài khoản.");
                setBusy(false); if (r?.ok) setEdit(null);
              }}>Lưu</button>
            </div>
            <hr className="border-cream-300" />
            <Field label="Đặt lại mật khẩu (tối thiểu 10 ký tự)" htmlFor="npw">
              <div className="flex gap-2"><input id="npw" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
                <button className="btn-secondary" disabled={busy || pw.length < 10} onClick={async () => { setBusy(true); const r = await run(() => resetPasswordAction({ id: edit.id, password: pw }), "Đã đặt lại mật khẩu."); setBusy(false); if (r?.ok) setPw(""); }}>Đặt lại</button></div>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ bàn
interface TableRow { id: string; code: string; floor_code: string; capacity: number; ops_status: keyof typeof TABLE_OPS; active: boolean; note: string | null; sort_order: number }
export function TablesAdmin({ tables, floors }: { tables: TableRow[]; floors: Floor[] }) {
  const run = useRun();
  const [edit, setEdit] = useState<null | { id: string | null; code: string; floor: string; capacity: string; active: boolean; note: string }>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-stone-600">Danh mục khởi tạo lấy từ file “Cấu hình NH Khoái.xlsx”. Chỉ thêm / sửa khi thực tế thay đổi.</p>
        <button className="btn-primary ml-auto" onClick={() => setEdit({ id: null, code: "", floor: floors[0]?.code ?? "", capacity: "4", active: true, note: "" })}>+ Thêm bàn</button>
      </div>
      {floors.map((fl) => {
        const list = tables.filter((t) => t.floor_code === fl.code);
        return (
          <section key={fl.code} className="card !p-0 overflow-x-auto">
            <h2 className={`border-l-[10px] bg-cream-100 px-4 py-2 font-bold ${floorStyle(fl.code).leftBar}`}>{fl.name} — {list.filter((t) => t.active).length} bàn, {list.filter((t) => t.active).reduce((s, t) => s + t.capacity, 0)} chỗ</h2>
            <table className="w-full min-w-[520px]"><tbody className="divide-y divide-cream-200">
              {list.map((t) => (
                <tr key={t.id} className={t.active ? "" : "opacity-50"}>
                  <td className="td w-32 font-bold">{t.code}</td><td className="td">{t.capacity} chỗ</td>
                  <td className="td">{TABLE_OPS[t.ops_status]}{!t.active && " · đã ngưng dùng"}</td><td className="td text-stone-500">{t.note}</td>
                  <td className="td text-right"><button className="btn-secondary btn-sm" onClick={() => setEdit({ id: t.id, code: t.code, floor: t.floor_code, capacity: String(t.capacity), active: t.active, note: t.note ?? "" })}>Sửa</button></td>
                </tr>
              ))}
            </tbody></table>
          </section>
        );
      })}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Sửa bàn" : "Thêm bàn"}>
        {edit && (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            const r = await run(() => saveTableAction({ id: edit.id, code: edit.code, floor: edit.floor, capacity: Number(edit.capacity), active: edit.active, note: edit.note }), "Đã lưu bàn.");
            setBusy(false); if (r?.ok) setEdit(null);
          }}>
            <Field label="Mã bàn" htmlFor="tc" required hint="Giữ đúng mã thực tế, ví dụ A1, VIP 4, B1.10, STT."><input id="tc" className="input" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} required /></Field>
            <Field label="Tầng / khu" htmlFor="tf"><select id="tf" className="input" value={edit.floor} onChange={(e) => setEdit({ ...edit, floor: e.target.value })}>{floors.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}</select></Field>
            <Field label="Sức chứa" htmlFor="tcap" required><input id="tcap" className="input" inputMode="numeric" value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value.replace(/\D/g, "") })} required /></Field>
            <Field label="Ghi chú" htmlFor="tn"><input id="tn" className="input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Đang sử dụng trong danh mục</label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Hủy</button><button className="btn-primary" disabled={busy}>Lưu</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ danh mục
const KIND_LABEL: Record<string, string> = { source: "Nguồn khách", purpose: "Thể loại / Mục đích tiệc", deposit_method: "Phương thức cọc" };
export function LookupsAdmin({ lookups }: { lookups: Lookup[] }) {
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const save = async (l: { id: string | null; kind: string; label: string; active: boolean; sort: number }) => {
    setBusy(true); const r = await run(() => saveLookupAction(l), "Đã lưu danh mục."); setBusy(false); return r;
  };
  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Các mục mẫu dưới đây là <b>đề xuất ban đầu</b>, chưa được nhà hàng xác nhận. Hãy sửa, thêm hoặc ẩn cho phù hợp. Mục đã dùng trong lượt đặt chỉ nên ẩn, không xóa.</p>
      {Object.entries(KIND_LABEL).map(([kind, title]) => (
        <section key={kind} className="card">
          <h2 className="mb-2 text-lg font-bold">{title}</h2>
          <ul className="divide-y divide-cream-200">
            {lookups.filter((l) => l.kind === kind).map((l) => <LookupRow key={l.id + l.label + l.active} l={l} onSave={save} busy={busy} />)}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const label = (adding[kind] ?? "").trim(); if (!label) return; const r = await save({ id: null, kind, label, active: true, sort: 99 }); if (r?.ok) setAdding({ ...adding, [kind]: "" }); }}>
            <input className="input" placeholder="Thêm mục mới…" aria-label={`Thêm vào ${title}`} value={adding[kind] ?? ""} onChange={(e) => setAdding({ ...adding, [kind]: e.target.value })} />
            <button className="btn-primary" disabled={busy}>Thêm</button>
          </form>
        </section>
      ))}
    </div>
  );
}
function LookupRow({ l, onSave, busy }: { l: Lookup; onSave: (l: any) => Promise<any>; busy: boolean }) {
  const [label, setLabel] = useState(l.label);
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <input className={`input max-w-xs ${l.active ? "" : "opacity-50"}`} aria-label="Tên mục" value={label} onChange={(e) => setLabel(e.target.value)} />
      {label !== l.label && <button className="btn-primary btn-sm" disabled={busy} onClick={() => onSave({ id: l.id, kind: l.kind, label, active: l.active, sort: l.sort_order })}>Lưu tên</button>}
      <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onSave({ id: l.id, kind: l.kind, label: l.label, active: !l.active, sort: l.sort_order })}>{l.active ? "Ẩn" : "Hiện lại"}</button>
      {!l.active && <span className="text-xs text-stone-500">Đang ẩn</span>}
    </li>
  );
}

// ------------------------------------------------------------------ cấu hình
export function SettingsAdmin({ settings }: { settings: Settings }) {
  const run = useRun();
  const [s, setS] = useState({ open: settings.open_time.slice(0, 5), close: settings.close_time.slice(0, 5), buffer: String(settings.buffer_minutes), duration: String(settings.default_duration_minutes) });
  const [busy, setBusy] = useState(false);
  return (
    <form className="card max-w-xl space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await run(() => saveSettingsAction({ open: s.open, close: s.close, buffer: Number(s.buffer), duration: Number(s.duration) }), "Đã lưu cấu hình."); setBusy(false); }}>
      <p className="text-sm text-amber-900 rounded-xl bg-amber-50 p-3">Các giá trị mặc định (đệm dọn bàn 0 phút, thời lượng gợi ý 120 phút) là <b>đề xuất</b>, chưa được nhà hàng xác nhận.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Giờ mở cửa" htmlFor="so"><TimeInput id="so" className="" value={s.open} onChange={(v) => setS({ ...s, open: v })} /></Field>
        <Field label="Giờ đóng cửa" htmlFor="sc"><TimeInput id="sc" className="" value={s.close} onChange={(v) => setS({ ...s, close: v })} /></Field>
      </div>
      <Field label="Khoảng đệm dọn bàn giữa hai lượt (phút)" htmlFor="sb" hint="Áp dụng cho các lượt đặt tạo/sửa từ nay về sau; lượt đã có giữ nguyên khoảng đệm cũ cho đến khi được sửa giờ.">
        <input id="sb" className="input" inputMode="numeric" value={s.buffer} onChange={(e) => setS({ ...s, buffer: e.target.value.replace(/\D/g, "") })} />
      </Field>
      <Field label="Thời lượng gợi ý cho lượt đặt mới (phút)" htmlFor="sd"><input id="sd" className="input" inputMode="numeric" value={s.duration} onChange={(e) => setS({ ...s, duration: e.target.value.replace(/\D/g, "") })} /></Field>
      <button className="btn-primary" disabled={busy}>Lưu cấu hình</button>
    </form>
  );
}

// ------------------------------------------------------------------ nhật ký
export function AuditAdmin({ data, page, pageSize, entity, q }: { data: { total: number; rows: any[] }; page: number; pageSize: number; entity: string; q: string }) {
  const router = useRouter();
  const [qq, setQq] = useState(q);
  const [en, setEn] = useState(entity);
  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const go = (p: number, e = en, s = qq) => router.push(`/quan-ly/nhat-ky?${new URLSearchParams({ ...(e ? { entity: e } : {}), ...(s ? { q: s } : {}), page: String(p) })}`);
  return (
    <div className="space-y-3">
      <form className="card flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); go(1); }}>
        <div><label className="label" htmlFor="aq">Tìm (người thao tác, nội dung, mã đặt chỗ)</label><input id="aq" className="input w-72" value={qq} onChange={(e) => setQq(e.target.value)} /></div>
        <div><label className="label" htmlFor="ae">Loại</label>
          <select id="ae" className="input w-48" value={en} onChange={(e) => setEn(e.target.value)}>
            <option value="">Tất cả</option><option value="booking">Lượt đặt</option><option value="table">Bàn</option><option value="lookup">Danh mục</option><option value="settings">Cấu hình</option><option value="profile">Tài khoản</option>
          </select></div>
        <button className="btn-primary">Lọc</button>
        <span className="ml-auto text-sm text-stone-500">{data.total} bản ghi · chỉ xem, không sửa được</span>
      </form>
      {data.rows.length === 0 ? <EmptyState title="Chưa có bản ghi nào" /> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[760px]">
            <thead className="bg-cream-100"><tr><th className="th">Thời gian</th><th className="th">Người thao tác</th><th className="th">Thao tác</th><th className="th">Nội dung</th></tr></thead>
            <tbody className="divide-y divide-cream-200">
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="td whitespace-nowrap">{fmtDateTime(r.at)}</td>
                  <td className="td">{r.actor_name ?? "—"}</td>
                  <td className="td whitespace-nowrap">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="td">
                    {r.booking_id ? <Link className="font-semibold text-leaf-700 underline" href={`/dat-ban/${r.booking_id}`}>{r.booking_code}</Link> : null} {r.summary}
                    {r.changes?.diff && Object.keys(r.changes.diff).length > 0 && (
                      <div className="mt-1 text-xs text-stone-500">{Object.entries(r.changes.diff).map(([k, v]: any) => `${k}: ${fmt(v.from)} → ${fmt(v.to)}`).join(" · ")}</div>
                    )}
                    {r.changes?.reason && <div className="text-xs text-stone-500">Lý do: {r.changes.reason}</div>}
                    {r.changes?.override_reason && <div className="text-xs font-semibold text-amber-800">Ghi đè cảnh báo: {r.changes.override_reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => go(page - 1, entity, q)}>← Trước</button>
          <span className="text-sm">Trang {page} / {pages}</span>
          <button className="btn-secondary" disabled={page >= pages} onClick={() => go(page + 1, entity, q)}>Sau →</button>
        </nav>
      )}
    </div>
  );
}
const fmt = (v: any) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v));
