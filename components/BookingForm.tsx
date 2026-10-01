"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useAppContext } from "./ContextProvider";
import { useLive } from "./LiveSync";
import { TablePicker } from "./TablePicker";
import { Field, Modal, StatusChip } from "./ui";
import { createBookingAction, moveTableAction, setStatusAction, updateBookingAction } from "@/app/actions";
import { describeError } from "@/lib/errors";
import { addDays, floorTo, fmtDateTime, fmtMoney, fromVn, minutesOf, nowMinutes, timeOf, todayVn, vnParts } from "@/lib/time";
import type { Availability, Booking } from "@/lib/types";

export interface Prefill { date?: string; from?: string; to?: string; tableId?: string; walkIn?: boolean }
interface Item { key: string; name: string; qty: string; note: string }

const uid = () => crypto.randomUUID();
const digits = (s: string) => s.replace(/\D/g, "");
const moneyIn = (s: string) => { const d = digits(s); return d ? new Intl.NumberFormat("vi-VN").format(Number(d)) : ""; };

interface FormState {
  consultantId: string; eventName: string; customerName: string; phone: string; sourceId: string;
  bookedDate: string; bookedTime: string; date: string; from: string; to: string; nextDay: boolean;
  tableIds: string[]; party: string; kids: string; items: Item[]; purposeId: string; decoration: string;
  deposit: string; depositMethodId: string; depositDate: string; requests: string; contract: string;
  changeNote: string; status: "pending" | "confirmed";
}

function fromBooking(b: Booking): FormState {
  const s = vnParts(b.start_at), e = vnParts(b.end_at), bk = b.booked_at ? vnParts(b.booked_at) : null;
  return {
    consultantId: b.consultant_id ?? "", eventName: b.event_name ?? "", customerName: b.customer_name ?? "", phone: b.customer_phone ?? "",
    sourceId: b.source_id ?? "", bookedDate: bk?.date ?? "", bookedTime: bk?.time ?? "", date: s.date, from: s.time, to: e.time,
    nextDay: e.date !== s.date, tableIds: b.tables.map((t) => t.id), party: String(b.party_size), kids: String(b.children_count),
    items: b.items.map((i) => ({ key: uid(), name: i.name, qty: String(i.qty), note: i.note ?? "" })),
    purposeId: b.purpose_id ?? "", decoration: b.decoration ?? "",
    deposit: b.deposit_amount ? moneyIn(String(b.deposit_amount)) : "", depositMethodId: b.deposit_method_id ?? "", depositDate: b.deposit_date ?? "",
    requests: b.special_requests ?? "", contract: b.contract_code ?? "", changeNote: b.change_note ?? "",
    status: b.status === "confirmed" ? "confirmed" : "pending",
  };
}

const FIELD_NAMES: [keyof FormState, string][] = [
  ["customerName", "Tên khách"], ["phone", "Số điện thoại"], ["eventName", "Tên tiệc"], ["date", "Ngày"], ["from", "Giờ bắt đầu"], ["to", "Giờ kết thúc"],
  ["tableIds", "Bàn"], ["party", "Số khách"], ["kids", "Số trẻ em"], ["deposit", "Tiền cọc"], ["requests", "Yêu cầu riêng"], ["decoration", "Trang trí"],
  ["contract", "Mã HĐ"], ["purposeId", "Mục đích"], ["sourceId", "Nguồn khách"], ["items", "Món yêu cầu"], ["consultantId", "Nhân viên tư vấn"],
];
const changedFields = (a: FormState, b: FormState) => FIELD_NAMES.filter(([k]) => {
  const x = k === "items" ? JSON.stringify(a.items.map((i) => [i.name, i.qty, i.note])) : JSON.stringify(a[k]);
  const y = k === "items" ? JSON.stringify(b.items.map((i) => [i.name, i.qty, i.note])) : JSON.stringify(b[k]);
  return x !== y;
}).map(([, n]) => n);

export function BookingForm({ booking, prefill }: { booking?: Booking; prefill?: Prefill }) {
  const ctx = useAppContext();
  const router = useRouter();
  const { tick } = useLive();
  const isEdit = !!booking;
  const walkIn = isEdit ? booking!.is_walk_in : !!prefill?.walkIn;
  const isManager = ctx.me.role === "manager";
  const readOnly = isEdit && ["completed", "cancelled", "no_show"].includes(booking!.status);

  const initial = useMemo<FormState>(() => {
    if (booking) return fromBooking(booking);
    const now = new Date();
    const nm = nowMinutes(now);
    const date = prefill?.date ?? todayVn(now);
    const nowStart = walkIn ? timeOf(floorTo(nm, 15)) : null;
    // Khung giờ đang xem trên bảng bàn (nếu không phải "cả ngày") được mang sang biểu mẫu
    const chosen = !!prefill?.from && !!prefill?.to
      && !(prefill.from === ctx.settings.open_time.slice(0, 5) && prefill.to === ctx.settings.close_time.slice(0, 5))
      && minutesOf(prefill.to) > minutesOf(prefill.from);
    const from = walkIn ? nowStart! : chosen ? prefill!.from! : (date === todayVn(now) ? timeOf(Math.min(floorTo(nm + 30, 30), 22 * 60)) : "18:00");
    const to = walkIn ? timeOf(Math.min(minutesOf(nowStart!) + ctx.settings.default_duration_minutes, 23 * 60 + 59))
      : chosen ? prefill!.to!
      : timeOf(Math.min(minutesOf(from) + ctx.settings.default_duration_minutes, 23 * 60 + 59));
    return {
      consultantId: ctx.me.id, eventName: "", customerName: "", phone: "", sourceId: "",
      bookedDate: todayVn(now), bookedTime: timeOf(nm), date, from, to, nextDay: false,
      tableIds: prefill?.tableId ? [prefill.tableId] : [], party: "", kids: "0", items: [], purposeId: "", decoration: "",
      deposit: "", depositMethodId: "", depositDate: "", requests: "", contract: "", changeNote: "", status: "pending",
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [f, setF] = useState<FormState>(initial);
  const [baseline, setBaseline] = useState<FormState>(initial);      // nội dung gốc để biết có thay đổi chưa lưu
  const [ack, setAck] = useState(0);                                 // phiên bản do chính tôi vừa tạo ra
  const [base, setBase] = useState<Booking | undefined>(booking);   // phiên bản mà form đang dựa vào
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<null | { kind: "error" | "warning" | "conflict"; text: string; can?: boolean; latest?: Booking | null }>(null);
  const [override, setOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [avail, setAvail] = useState<Availability[] | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [availError, setAvailError] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const reqRef = useRef<{ key: string; id: string }>({ key: "", id: uid() });
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(baseline), [f, baseline]);
  const adopt = (b: Booking) => { const x = fromBooking(b); setF(x); setBaseline(x); setBase(b); };
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  // Dữ liệu trên máy chủ mới hơn bản đang mở (do chính tôi hoặc người khác)?
  const newerOnServer = !!(isEdit && booking && base && booking.version > base.version && booking.version > ack);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; });
  useEffect(() => {
    if (!isEdit || !booking || !base || booking.version <= base.version) return;
    const mine = booking.version <= ack;
    if (!dirtyRef.current) adopt(booking);                  // chưa sửa gì → tự cập nhật theo bản mới
    else if (mine) setBase(booking);                         // thay đổi do tôi làm → giữ nội dung đang nhập
  }, [booking, base, isEdit, ack]);

  // ---- thời gian
  const startIso = /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.from ? fromVn(f.date, f.from) : null;
  const endDate = f.nextDay ? addDays(f.date, 1) : f.date;
  const endIso = /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.to ? fromVn(endDate, f.to) : null;
  const windowOk = !!startIso && !!endIso && new Date(endIso) > new Date(startIso);

  const loadAvail = useCallback(async (signal?: AbortSignal) => {
    if (!startIso || !endIso || !windowOk) return;
    setAvailLoading(true);
    try {
      const q = new URLSearchParams({ start: startIso, end: endIso });
      if (booking) q.set("exclude", booking.id);
      const r = await fetch(`/api/availability?${q}`, { signal, cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setAvail(await r.json());
      setAvailError(false);
    } catch (e: any) {
      if (e?.name !== "AbortError") setAvailError(true);
    } finally { setAvailLoading(false); }
  }, [startIso, endIso, windowOk, booking]);

  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => loadAvail(c.signal), 250);
    return () => { clearTimeout(t); c.abort(); };
  }, [loadAvail, tick]);

  const selectedTables = (avail ?? []).filter((t) => f.tableIds.includes(t.id));
  const totalCap = selectedTables.reduce((s, t) => s + t.capacity, 0);
  const party = Number(f.party) || 0;
  const conflicts = selectedTables.filter((t) => t.conflict);
  const overCap = party > 0 && avail && totalCap > 0 && party > totalCap;
  const toggleTable = (id: string) => set("tableIds", f.tableIds.includes(id) ? f.tableIds.filter((x) => x !== id) : [...f.tableIds, id]);

  const lookups = (kind: string, current: string) => ctx.lookups.filter((l) => l.kind === kind && (l.active || l.id === current));

  // ---- gửi
  function validate() {
    const e: Record<string, string> = {};
    if (!walkIn) {
      if (!f.customerName.trim()) e.customerName = "Nhập tên khách đặt.";
      if (!f.phone.trim()) e.phone = "Nhập số điện thoại liên hệ.";
    }
    if (f.phone.trim() && !/^\+?[0-9]{8,15}$/.test(f.phone.replace(/[\s.\-()]/g, ""))) e.phone = "Số điện thoại không hợp lệ (8–15 chữ số).";
    if (!(party >= 1)) e.party = "Nhập số lượng khách (từ 1).";
    if ((Number(f.kids) || 0) > party && party >= 1) e.kids = "Số trẻ em không được lớn hơn tổng số khách.";
    if (!windowOk) e.to = "Giờ kết thúc phải sau giờ bắt đầu.";
    if (f.tableIds.length === 0) e.tables = "Chọn ít nhất một bàn.";
    if (f.items.some((i) => i.name.trim() && !(Number(i.qty) >= 1))) e.items = "Số phần của mỗi món phải từ 1 trở lên.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function payload() {
    return {
      data: {
        consultant_id: f.consultantId || null, event_name: f.eventName, customer_name: f.customerName, customer_phone: f.phone,
        source_id: f.sourceId || null, purpose_id: f.purposeId || null, start_at: startIso, end_at: endIso,
        booked_at: f.bookedDate && f.bookedTime ? fromVn(f.bookedDate, f.bookedTime) : null,
        party_size: party, children_count: Number(f.kids) || 0, decoration: f.decoration, special_requests: f.requests,
        deposit_amount: f.deposit ? Number(digits(f.deposit)) : null, deposit_method_id: f.depositMethodId || null,
        deposit_date: f.depositDate || null, contract_code: f.contract, change_note: f.changeNote,
        ...(isEdit ? {} : { status: f.status }),
      },
      tables: f.tableIds,
      items: f.items.filter((i) => i.name.trim()).map((i) => ({ name: i.name, qty: Number(i.qty), note: i.note })),
    };
  }

  async function submit(useOverride = false) {
    setPanel(null);
    if (!validate()) { toast.error("Còn thông tin chưa hợp lệ — xem các ô báo đỏ."); return; }
    if (!navigator.onLine) { setPanel({ kind: "error", text: describeError({ code: "E_NETWORK", message: "" }) }); toast.error("Chưa lưu — đang mất kết nối mạng."); return; }
    setSaving(true);
    const p = payload();
    const key = JSON.stringify([p, useOverride ? override : "", base?.version]);
    if (reqRef.current.key !== key) reqRef.current = { key, id: uid() };   // dữ liệu đổi → yêu cầu mới; cùng dữ liệu → gửi lại an toàn
    try {
      const overrideReason = useOverride ? override.trim() : null;
      const r = isEdit
        ? await updateBookingAction({ requestId: reqRef.current.id, id: booking!.id, version: base!.version, ...p, overrideReason })
        : await createBookingAction({ requestId: reqRef.current.id, ...p, overrideReason, walkIn });
      if (r.ok) {
        toast.success(isEdit ? "Đã lưu thay đổi." : walkIn ? `Đã tiếp nhận khách — mã ${r.data.code}.` : `Đã tạo lượt đặt ${r.data.code}.`);
        if (isEdit) { setAck(r.data.version); setBaseline(f); setBase((p) => (p ? { ...p, version: r.data.version } : p)); router.refresh(); } else { router.push(`/dat-ban/${r.data.id}`); }
        return;
      }
      if (r.error.code === "E_WARNING") {
        setPanel({ kind: "warning", text: describeError(r.error), can: !!r.error.detail?.can_override });
      } else if (r.error.code === "E_VERSION") {
        setPanel({ kind: "conflict", text: r.message, latest: r.latest });
      } else {
        setPanel({ kind: "error", text: r.message });
        toast.error("Chưa lưu được — xem thông báo phía trên.");
        if (r.error.code === "E_OVERLAP") loadAvail();
      }
    } catch {
      setPanel({ kind: "error", text: describeError({ code: "E_NETWORK", message: "" }) });
      toast.error("Chưa lưu — mất kết nối với máy chủ.");
    } finally { setSaving(false); }
  }

  async function statusAction(action: string, reason?: string) {
    if (!base) return false;
    if (!navigator.onLine) { toast.error("Chưa lưu — đang mất kết nối mạng."); return false; }
    setSaving(true);
    try {
      const r = await setStatusAction({ requestId: uid(), id: base.id, version: base.version, action, reason });
      if (r.ok) {
        toast.success({ confirm: "Đã xác nhận lượt đặt.", check_in: "Đã ghi nhận khách đến — bắt đầu phục vụ.", complete: "Đã hoàn tất — bàn chuyển sang chờ dọn.", cancel: "Đã hủy lượt đặt.", no_show: "Đã ghi nhận khách không đến." }[action] ?? "Đã lưu.");
        setAck(r.data.version); router.refresh();
        return true;
      }
      setPanel({ kind: r.error.code === "E_VERSION" ? "conflict" : "error", text: r.message, latest: r.latest });
      toast.error("Chưa thực hiện được — xem thông báo.");
    } catch { toast.error("Chưa lưu — mất kết nối với máy chủ."); }
    finally { setSaving(false); }
    return false;
  }

  async function doMove(to: string) {
    if (!base || !moveFrom) return;
    setSaving(true);
    try {
      const r = await moveTableAction({ requestId: uid(), id: base.id, version: base.version, from: moveFrom, to, overrideReason: null });
      if (r.ok) { toast.success("Đã chuyển bàn."); setMoveFrom(null); setAck(r.data.version); router.refresh(); }
      else { setPanel({ kind: r.error.code === "E_VERSION" ? "conflict" : "error", text: r.message, latest: r.latest }); setMoveFrom(null); }
    } catch { toast.error("Chưa lưu — mất kết nối với máy chủ."); }
    finally { setSaving(false); }
  }

  const status = booking?.status;
  const baseForm = base ? fromBooking(base) : baseline;
  const serverDiff = newerOnServer ? changedFields(baseForm, fromBooking(booking!)) : [];

  const title = isEdit ? `Lượt đặt ${booking!.code}` : walkIn ? "Tiếp nhận khách vãng lai" : "Đặt bàn mới";
  return (
    <form className="mx-auto max-w-4xl space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold text-leaf-900 sm:text-2xl">{title}</h1>
        {booking && <StatusChip status={booking.status} />}
        {booking?.is_walk_in && <span className="chip bg-stone-100 text-stone-700 ring-stone-300">Khách vãng lai</span>}
        {booking?.is_demo && <span className="chip bg-violet-100 text-violet-800 ring-violet-300">Dữ liệu demo</span>}
      </div>

      {isEdit && booking && (
        <p className="text-sm text-stone-500">
          Tạo bởi {booking.created_by_name ?? "—"} lúc {fmtDateTime(booking.created_at)} · Sửa lần cuối bởi {booking.updated_by_name ?? "—"} lúc {fmtDateTime(booking.updated_at)}
        </p>
      )}

      {newerOnServer && panel?.kind !== "conflict" && (
        <div role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm">
          <b>{booking!.updated_by_name ?? "Người khác"}</b> vừa sửa lượt đặt này lúc {fmtDateTime(booking!.updated_at)}
          {serverDiff.length > 0 && <> (đã đổi: {serverDiff.join(", ")})</>}. Nội dung bạn đang nhập được giữ nguyên.
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => adopt(booking!)}>Dùng dữ liệu mới nhất (bỏ phần tôi nhập)</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setBase(booking)}>Giữ nội dung của tôi và lưu đè khi tôi bấm Lưu</button>
          </div>
        </div>
      )}

      {panel && (
        <div role="alert" className={`rounded-xl border-2 p-3 text-sm ${panel.kind === "warning" ? "border-amber-400 bg-amber-50" : "border-red-500 bg-red-50"}`}>
          <div className="flex gap-2"><AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden /><div className="space-y-2">
            <p className="font-semibold">{panel.text}</p>
            {panel.kind === "warning" && panel.can && (
              <div>
                <label className="label" htmlFor="override">Lý do ghi đè cảnh báo (bắt buộc)</label>
                <input id="override" className="input" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Ví dụ: Khách đã báo trước, kê thêm ghế" />
                <button type="button" className="btn-accent mt-2" disabled={!override.trim() || saving} onClick={() => submit(true)}>Ghi đè và lưu</button>
              </div>
            )}
            {panel.kind === "conflict" && (
              <div className="flex flex-wrap gap-2">
                {panel.latest && <button type="button" className="btn-secondary btn-sm" onClick={() => { adopt(panel.latest!); setPanel(null); router.refresh(); }}>Dùng dữ liệu mới nhất (bỏ phần tôi nhập)</button>}
                {panel.latest && <button type="button" className="btn-secondary btn-sm" onClick={() => { setBase(panel.latest!); setPanel(null); toast.info("Đã cập nhật phiên bản. Kiểm tra rồi bấm Lưu để áp dụng nội dung của bạn."); }}>Giữ nội dung của tôi để lưu lại</button>}
              </div>
            )}
          </div></div>
        </div>
      )}

      {isEdit && booking && !readOnly && (
        <div className="card flex flex-wrap items-center gap-2" aria-label="Thao tác phục vụ">
          <span className="mr-2 text-sm font-semibold text-stone-600">Thao tác:</span>
          {status === "pending" && <button type="button" className="btn-primary" disabled={saving} onClick={() => statusAction("confirm")}>Xác nhận</button>}
          {(status === "pending" || status === "confirmed") && <button type="button" className="btn-accent" disabled={saving} onClick={() => statusAction("check_in")}>Khách đến — bắt đầu phục vụ</button>}
          {status === "arrived" && <button type="button" className="btn-primary" disabled={saving} onClick={() => statusAction("complete")}>Hoàn tất phục vụ</button>}
          {(status === "pending" || status === "confirmed") && <button type="button" className="btn-secondary" disabled={saving} onClick={() => confirm("Ghi nhận khách KHÔNG ĐẾN? Bàn sẽ được nhả cho người khác đặt.") && statusAction("no_show")}>Khách không đến</button>}
          {(status === "pending" || status === "confirmed") && <button type="button" className="btn-danger" disabled={saving} onClick={() => setCancelOpen(true)}>Hủy đặt bàn</button>}
        </div>
      )}
      {readOnly && <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">Lượt đặt đã kết thúc nên chỉ xem, không sửa được.{booking?.cancel_reason ? ` Lý do: ${booking.cancel_reason}` : ""}</p>}

      <fieldset disabled={readOnly || saving} className="space-y-4">
        {/* 1. Khách hàng */}
        <section className="card" aria-labelledby="g1">
          <h2 id="g1" className="mb-3 text-lg font-bold text-leaf-900">1. Khách hàng</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tên khách đặt" htmlFor="customerName" required={!walkIn} error={errors.customerName}>
              <input id="customerName" className="input" value={f.customerName} onChange={(e) => set("customerName", e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Số điện thoại" htmlFor="phone" required={!walkIn} error={errors.phone}>
              <input id="phone" className="input" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0901 234 567" autoComplete="off" />
            </Field>
            <Field label="Tên tiệc / Tên bàn đặt" htmlFor="eventName">
              <input id="eventName" className="input" value={f.eventName} onChange={(e) => set("eventName", e.target.value)} placeholder="Ví dụ: Sinh nhật bé Na" />
            </Field>
            <Field label="Nguồn khách" htmlFor="sourceId">
              <select id="sourceId" className="input" value={f.sourceId} onChange={(e) => set("sourceId", e.target.value)}>
                <option value="">— Chưa chọn —</option>
                {lookups("source", f.sourceId).map((l) => <option key={l.id} value={l.id}>{l.label}{l.active ? "" : " (đã ẩn)"}</option>)}
              </select>
            </Field>
            <Field label="Nhân viên tư vấn" htmlFor="consultantId">
              <select id="consultantId" className="input" value={f.consultantId} onChange={(e) => set("consultantId", e.target.value)}>
                <option value="">— Chưa chọn —</option>
                {ctx.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </Field>
            <Field label="Ngày giờ khách đặt bàn / đặt tiệc" hint="Thời điểm khách báo đặt (khác với lúc nhân viên nhập vào hệ thống).">
              <div className="flex gap-2">
                <input type="date" aria-label="Ngày khách đặt" className="input" value={f.bookedDate} onChange={(e) => set("bookedDate", e.target.value)} />
                <input type="time" aria-label="Giờ khách đặt" className="input w-36" value={f.bookedTime} onChange={(e) => set("bookedTime", e.target.value)} />
              </div>
            </Field>
          </div>
        </section>

        {/* 2. Thời gian & bàn */}
        <section className="card" aria-labelledby="g2">
          <h2 id="g2" className="mb-3 text-lg font-bold text-leaf-900">2. Thời gian &amp; bàn</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Ngày diễn ra tiệc" htmlFor="date" required className="sm:col-span-2">
              <input id="date" type="date" className="input" value={f.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="Giờ bắt đầu" htmlFor="from" required>
              <input id="from" type="time" step={900} className="input" value={f.from} onChange={(e) => set("from", e.target.value)} />
            </Field>
            <Field label="Giờ kết thúc dự kiến" htmlFor="to" required error={errors.to}>
              <input id="to" type="time" step={900} className="input" value={f.to} onChange={(e) => set("to", e.target.value)} />
            </Field>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.nextDay} onChange={(e) => set("nextDay", e.target.checked)} className="h-5 w-5" /> Kết thúc sang ngày hôm sau</label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Số lượng khách" htmlFor="party" required error={errors.party} hint="Tổng số người, đã gồm cả trẻ em.">
              <input id="party" className="input" inputMode="numeric" value={f.party} onChange={(e) => set("party", digits(e.target.value))} />
            </Field>
            <Field label="Trong đó trẻ em đi kèm" htmlFor="kids" error={errors.kids} hint="Nằm trong tổng số khách, không cộng thêm.">
              <input id="kids" className="input" inputMode="numeric" value={f.kids} onChange={(e) => set("kids", digits(e.target.value))} />
            </Field>
          </div>

          <div className="mt-4">
            <div className="mb-1 flex flex-wrap items-center gap-x-3">
              <span className="label !mb-0">Bàn được chọn <span className="text-red-600">*</span></span>
              <span className="text-sm text-stone-600">Số bàn: <b>{f.tableIds.length}</b>{avail && f.tableIds.length > 0 && <> · Tổng sức chứa: <b className={overCap ? "text-red-700" : ""}>{totalCap}</b>{party > 0 && <> / {party} khách</>}</>}</span>
            </div>
            {errors.tables && <p role="alert" className="mb-1 text-sm font-medium text-red-700">{errors.tables}</p>}
            {overCap && <p role="alert" className="mb-2 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900">Số khách vượt tổng sức chứa các bàn đã chọn. Hãy chọn thêm bàn{isManager ? " hoặc ghi đè kèm lý do khi lưu" : " (chỉ quản lý được ghi đè)"}.</p>}
            {conflicts.length > 0 && <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-800">Bàn {conflicts.map((c) => c.code).join(", ")} đã có người đặt trong khung giờ này — hãy bỏ chọn hoặc đổi giờ.</p>}
            <TablePicker availability={avail} loading={availLoading} error={availError} selected={f.tableIds} onToggle={toggleTable} needReady={walkIn}
              disabled={readOnly || saving} startIso={windowOk ? startIso : null} endIso={windowOk ? endIso : null} onRetry={() => loadAvail()} />
            {isEdit && !readOnly && f.tableIds.length > 0 && !dirty && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-stone-600">Đổi bàn nhanh:</span>
                {selectedTables.map((t) => <button key={t.id} type="button" className="btn-secondary btn-sm" onClick={() => setMoveFrom(t.id)}>Chuyển bàn {t.code}…</button>)}
              </div>
            )}
          </div>
        </section>

        {/* 3. Yêu cầu tiệc */}
        <section className="card" aria-labelledby="g3">
          <h2 id="g3" className="mb-3 text-lg font-bold text-leaf-900">3. Yêu cầu tiệc</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Thể loại / Mục đích tiệc" htmlFor="purposeId">
              <select id="purposeId" className="input" value={f.purposeId} onChange={(e) => set("purposeId", e.target.value)}>
                <option value="">— Chưa chọn —</option>
                {lookups("purpose", f.purposeId).map((l) => <option key={l.id} value={l.id}>{l.label}{l.active ? "" : " (đã ẩn)"}</option>)}
              </select>
            </Field>
            <Field label="Thông tin trang trí bàn tiệc" htmlFor="decoration">
              <input id="decoration" className="input" value={f.decoration} onChange={(e) => set("decoration", e.target.value)} placeholder="Bóng bay, bánh kem, hoa…" />
            </Field>
          </div>
          <div className="mt-4">
            <span className="label">Các món yêu cầu &amp; số phần</span>
            {errors.items && <p role="alert" className="mb-1 text-sm font-medium text-red-700">{errors.items}</p>}
            {f.items.length === 0 && <p className="hint mb-2">Chưa có món nào. Chỉ ghi nhận yêu cầu của khách, không phải gọi món / tính tiền.</p>}
            <div className="space-y-2">
              {f.items.map((it, idx) => (
                <div key={it.key} className="grid grid-cols-[1fr_5rem_auto] gap-2 sm:grid-cols-[2fr_6rem_2fr_auto]">
                  <input aria-label={`Tên món ${idx + 1}`} className="input" placeholder="Tên món" value={it.name} onChange={(e) => set("items", f.items.map((x) => x.key === it.key ? { ...x, name: e.target.value } : x))} />
                  <input aria-label={`Số phần món ${idx + 1}`} className="input" inputMode="numeric" placeholder="Phần" value={it.qty} onChange={(e) => set("items", f.items.map((x) => x.key === it.key ? { ...x, qty: digits(e.target.value) } : x))} />
                  <input aria-label={`Ghi chú món ${idx + 1}`} className="input col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto" placeholder="Ghi chú (ít cay, không hành…)" value={it.note} onChange={(e) => set("items", f.items.map((x) => x.key === it.key ? { ...x, note: e.target.value } : x))} />
                  <button type="button" className="btn-ghost px-2 text-red-700" aria-label={`Xóa món ${idx + 1}`} onClick={() => set("items", f.items.filter((x) => x.key !== it.key))}><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
            <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => set("items", [...f.items, { key: uid(), name: "", qty: "1", note: "" }])}><Plus size={16} aria-hidden /> Thêm món</button>
          </div>
        </section>

        {/* 4. Đặt cọc */}
        <section className="card" aria-labelledby="g4">
          <h2 id="g4" className="mb-3 text-lg font-bold text-leaf-900">4. Đặt cọc</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Số tiền đặt cọc (VND)" htmlFor="deposit">
              <input id="deposit" className="input" inputMode="numeric" value={f.deposit} onChange={(e) => set("deposit", moneyIn(e.target.value))} placeholder="0" />
            </Field>
            <Field label="Phương thức cọc" htmlFor="depositMethodId">
              <select id="depositMethodId" className="input" value={f.depositMethodId} onChange={(e) => set("depositMethodId", e.target.value)}>
                <option value="">— Chưa chọn —</option>
                {lookups("deposit_method", f.depositMethodId).map((l) => <option key={l.id} value={l.id}>{l.label}{l.active ? "" : " (đã ẩn)"}</option>)}
              </select>
            </Field>
            <Field label="Ngày cọc" htmlFor="depositDate">
              <input id="depositDate" type="date" className="input" value={f.depositDate} onChange={(e) => set("depositDate", e.target.value)} />
            </Field>
          </div>
          <p className="hint">{f.deposit ? `Đã ghi nhận cọc ${fmtMoney(Number(digits(f.deposit)))}. ` : "Chưa cọc. "}Tiền cọc chỉ để theo dõi — không tính là doanh thu; ứng dụng không xử lý thanh toán hay hoàn tiền khi hủy.</p>
        </section>

        {/* 5. Ghi chú */}
        <section className="card" aria-labelledby="g5">
          <h2 id="g5" className="mb-3 text-lg font-bold text-leaf-900">5. Ghi chú</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Yêu cầu riêng" htmlFor="requests" className="sm:col-span-2">
              <textarea id="requests" rows={3} className="input" value={f.requests} onChange={(e) => set("requests", e.target.value)} placeholder="Dị ứng, ăn chay, vị trí ngồi, giờ lên món…" />
            </Field>
            <Field label="Mã HĐ" htmlFor="contract">
              <input id="contract" className="input" value={f.contract} onChange={(e) => set("contract", e.target.value)} />
            </Field>
            {!isEdit && (
              <Field label="Trạng thái" htmlFor="status">
                <select id="status" className="input" value={f.status} onChange={(e) => set("status", e.target.value as any)}>
                  <option value="pending">Chờ xác nhận</option>
                  <option value="confirmed">Đã xác nhận</option>
                </select>
              </Field>
            )}
            <Field label="Lý do thay đổi / ghi chú đặc biệt" htmlFor="changeNote" className="sm:col-span-2">
              <input id="changeNote" className="input" value={f.changeNote} onChange={(e) => set("changeNote", e.target.value)} placeholder="Ví dụ: Khách đổi từ 18:00 sang 19:00" />
            </Field>
          </div>
        </section>
      </fieldset>

      {!readOnly && (
        <div className="sticky bottom-0 z-20 -mx-3 flex flex-wrap items-center gap-2 border-t border-cream-300 bg-cream-50/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <button type="submit" className="btn-primary min-w-40" disabled={saving}>{saving ? "Đang lưu…" : isEdit ? "Lưu thay đổi" : walkIn ? "Tiếp nhận khách" : "Lưu lượt đặt"}</button>
          <button type="button" className="btn-secondary" onClick={() => router.back()} disabled={saving}>Quay lại</button>
          {dirty && <span className="text-sm text-stone-500">Có thay đổi chưa lưu</span>}
        </div>
      )}

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Hủy đặt bàn">
        <p className="mb-3 text-sm text-stone-600">Lượt đặt sẽ được giữ trong lịch sử, bàn được nhả cho người khác. Tiền cọc (nếu có) cần xử lý riêng — hệ thống không tự hoàn tiền.</p>
        <label className="label" htmlFor="cancelReason">Lý do hủy <span className="text-red-600">*</span></label>
        <input id="cancelReason" className="input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setCancelOpen(false)}>Không hủy</button>
          <button type="button" className="btn-danger" disabled={!cancelReason.trim() || saving} onClick={async () => { if (await statusAction("cancel", cancelReason)) { setCancelOpen(false); setCancelReason(""); } }}>Xác nhận hủy</button>
        </div>
      </Modal>

      <Modal open={!!moveFrom} onClose={() => setMoveFrom(null)} title={`Chuyển bàn ${(avail ?? []).find((t) => t.id === moveFrom)?.code ?? ""}`} wide>
        <p className="mb-2 text-sm text-stone-600">Chọn bàn thay thế (cùng khung giờ). Hệ thống kiểm tra trùng lịch và chuyển nguyên tử.</p>
        <TablePicker availability={(avail ?? []).filter((t) => !f.tableIds.includes(t.id))} loading={availLoading} error={availError} selected={[]}
          onToggle={doMove} needReady={status === "arrived"} startIso={startIso} endIso={endIso} onRetry={() => loadAvail()} />
      </Modal>
    </form>
  );
}
