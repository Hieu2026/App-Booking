"use client";
import { useEffect, useState } from "react";
import { getHistoryAction } from "@/app/actions";
import { ACTION_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/time";
import type { HistoryEntry } from "@/lib/types";

const show = (v: any) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.join(", ") : "—") : String(v));

export function HistoryPanel({ bookingId, version }: { bookingId: string; version: number }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    getHistoryAction(bookingId).then((r) => { if (!alive) return; if (r.ok) { setRows(r.data); setErr(false); } else setErr(true); }).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [bookingId, version]);
  return (
    <section className="card mx-auto max-w-4xl" aria-labelledby="hist">
      <h2 id="hist" className="mb-3 text-lg font-bold text-leaf-900">Lịch sử thay đổi</h2>
      {err && <p className="text-sm text-red-700">Chưa tải được lịch sử. Hãy tải lại trang.</p>}
      {!rows && !err && <p className="text-sm text-stone-500">Đang tải…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-stone-500">Chưa có lịch sử.</p>}
      <ol className="space-y-3">
        {rows?.map((h) => {
          const diff = h.changes?.diff as Record<string, { from: any; to: any }> | undefined;
          return (
            <li key={h.id} className="border-l-4 border-leaf-200 pl-3">
              <div className="text-sm"><b>{ACTION_LABEL[h.action] ?? h.summary}</b> · {h.actor_name ?? "—"} · <span className="text-stone-500">{fmtDateTime(h.at)}</span></div>
              {h.changes?.reason && <div className="text-sm text-stone-600">Lý do: {h.changes.reason}</div>}
              {h.changes?.override_reason && <div className="text-sm font-semibold text-amber-800">Quản lý ghi đè cảnh báo — lý do: {h.changes.override_reason}</div>}
              {diff && Object.keys(diff).length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm text-stone-600">
                  {Object.entries(diff).map(([k, v]) => <li key={k}><span className="font-medium">{k}:</span> {show(v.from)} → <b>{show(v.to)}</b></li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
