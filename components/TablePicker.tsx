"use client";
import { useAppContext } from "./ContextProvider";
import { AlertTriangle, Users } from "lucide-react";
import { fmtTime } from "@/lib/time";
import { floorStyle } from "@/lib/board";
import type { Availability } from "@/lib/types";

interface Props {
  availability: Availability[] | null;
  loading: boolean;
  error: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  needReady: boolean;   // khách vãng lai: chỉ chọn bàn đang sẵn sàng
  disabled?: boolean;
  startIso: string | null;
  endIso: string | null;
  onRetry: () => void;
}

export function TablePicker({ availability, loading, error, selected, onToggle, needReady, disabled, startIso, endIso, onRetry }: Props) {
  const ctx = useAppContext();
  if (!startIso || !endIso) return <p className="hint">Chọn ngày và giờ hợp lệ để xem bàn trống.</p>;
  if (error) return (
    <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
      Chưa tải được tình trạng bàn (có thể mất kết nối). <button type="button" className="font-bold underline" onClick={onRetry}>Thử lại</button>
    </div>
  );
  if (!availability) return <p className="hint">Đang tải tình trạng bàn…</p>;
  return (
    <div className={`space-y-3 ${loading ? "opacity-70" : ""}`} aria-busy={loading}>
      {ctx.floors.map((f) => {
        const list = availability.filter((t) => t.floor_code === f.code);
        if (!list.length) return null;
        return (
          <div key={f.code}>
            <div className="mb-1 text-sm font-bold text-leaf-900">{f.name}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((t) => {
                const sel = selected.includes(t.id);
                const conflict = t.conflict;
                const suspended = t.ops_status === "suspended";
                const notReady = needReady && t.ops_status !== "ready";
                const blocked = (!!conflict || suspended || notReady) && !sel;
                const servingLate = t.serving && startIso && new Date(t.serving.end_at).getTime() > new Date(startIso).getTime();
                const tight = t.next_start && endIso && new Date(t.next_start).getTime() - new Date(endIso).getTime() < 30 * 60000;
                let note = "Trống";
                const fs = floorStyle(t.floor_code);
                let tone = `${fs.border} ${fs.bg} ${fs.text}`;
                if (suspended) { note = "Tạm ngưng"; tone = "border-stone-300 bg-stone-100 text-stone-500"; }
                else if (conflict) { note = `Đã đặt ${fmtTime(conflict.start_at)}–${fmtTime(conflict.end_at)} · ${conflict.booking_code}`; tone = "border-red-500 bg-red-100 text-red-900"; }
                else if (notReady) { note = t.ops_status === "serving" ? "Đang phục vụ" : "Chờ dọn"; tone = "border-amber-500 bg-amber-50 text-amber-900"; }
                else if (servingLate) { note = `Đang phục vụ đến ${fmtTime(t.serving!.end_at)}`; tone = "border-amber-500 bg-amber-50 text-amber-900"; }
                else if (tight) { note = `Trống · lượt kế tiếp ${fmtTime(t.next_start!)}`; tone = "border-yellow-400 bg-yellow-50 text-yellow-900"; }
                return (
                  <button key={t.id} type="button" disabled={disabled || blocked} aria-pressed={sel} data-testid={`pick-${t.code}`}
                    onClick={() => onToggle(t.id)} title={note}
                    className={`min-h-16 rounded-xl border-2 border-l-[10px] ${fs.leftBar} p-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${tone} ${sel ? "ring-4 ring-leaf-600 ring-offset-1" : ""}`}>
                    <div className="flex items-center justify-between font-extrabold">
                      <span>{t.code}</span>
                      <span className="flex items-center gap-1 text-xs"><Users size={13} aria-hidden />{t.capacity}</span>
                    </div>
                    <div className="mt-0.5 text-xs leading-snug">
                      {sel && conflict ? <span className="font-bold text-red-800"><AlertTriangle size={12} className="mr-1 inline" aria-hidden />Trùng lịch: {note}</span> : sel ? <b>✓ Đã chọn · {note}</b> : note}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
