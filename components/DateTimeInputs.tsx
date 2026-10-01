"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";

interface Common { id?: string; value: string; onChange: (v: string) => void; className?: string; "aria-label"?: string; disabled?: boolean }

const digitsOf = (s: string) => s.replace(/\D/g, "");
const isoToView = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
function viewToIso(v: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function maskDate(raw: string) {
  const d = digitsOf(raw).slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter((x, i) => x || i === 0).join("/");
}

/** Ô ngày luôn hiển thị dd/mm/yyyy (không phụ thuộc ngôn ngữ trình duyệt). Giá trị trao đổi: "YYYY-MM-DD". */
export function DateInput({ id, value, onChange, className = "", disabled, ...rest }: Common) {
  const [text, setText] = useState(isoToView(value));
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { if (viewToIso(text) !== value && !(value === "" && text !== "" && viewToIso(text) === null)) setText(isoToView(value)); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value]);
  return (
    <div className={`relative ${className}`}>
      <input id={id} className="input w-full !pl-2.5 !pr-9" inputMode="numeric" placeholder="dd/mm/yyyy" maxLength={10} autoComplete="off" disabled={disabled}
        aria-label={rest["aria-label"]} aria-invalid={bad} value={text}
        onChange={(e) => {
          const t = maskDate(e.target.value);
          setText(t);
          if (t === "") { setBad(false); onChange(""); return; }
          const iso = viewToIso(t);
          setBad(t.length === 10 && !iso);
          if (iso) onChange(iso);
        }}
        onBlur={() => { if (viewToIso(text) === null) { setText(isoToView(value)); setBad(false); } }} />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label="Mở lịch chọn ngày"
        className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-stone-500 hover:bg-cream-100"
        onClick={() => { try { picker.current?.showPicker(); } catch { picker.current?.focus(); } }}>
        <CalendarDays size={18} aria-hidden />
      </button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden value={value} onChange={(e) => e.target.value && onChange(e.target.value)}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0" />
    </div>
  );
}

/** Ô giờ 24 giờ HH:mm (không AM/PM). Phím ↑/↓ đổi ±15 phút. Giá trị: "HH:mm". */
export function TimeInput({ id, value, onChange, className = "", disabled, ...rest }: Common) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const valid = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const step = (dir: number) => {
    const [h, m] = (valid(text) ? text : value || "00:00").split(":").map(Number);
    const t = ((h * 60 + m + dir * 15) % 1440 + 1440) % 1440;
    const n = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    setText(n); onChange(n);
  };
  return (
    <input id={id} className={`input ${className}`} inputMode="numeric" placeholder="HH:mm" maxLength={5} autoComplete="off" disabled={disabled}
      aria-label={rest["aria-label"]} value={text}
      onChange={(e) => {
        const d = digitsOf(e.target.value).slice(0, 4);
        const t = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
        setText(t);
        if (valid(t)) onChange(t);
      }}
      onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); step(1); } else if (e.key === "ArrowDown") { e.preventDefault(); step(-1); } }}
      onBlur={() => { if (!valid(text)) setText(value); }} />
  );
}
