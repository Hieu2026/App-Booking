"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { BOOKING_STATUS } from "@/lib/labels";
import { describeError } from "@/lib/errors";
import type { ActionResult } from "@/app/actions";
import type { BookingStatus } from "@/lib/types";

export function StatusChip({ status }: { status: BookingStatus }) {
  const s = BOOKING_STATUS[status];
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

/**
 * Chạy thao tác ghi: chỉ báo thành công khi máy chủ đã xác nhận; mất mạng thì báo "chưa lưu".
 */
export function useRun() {
  const router = useRouter();
  return useCallback(async function run<T>(fn: () => Promise<ActionResult<T>>, success: string): Promise<ActionResult<T> | null> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error(describeError({ code: "E_NETWORK", message: "offline" }));
      return null;
    }
    try {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.message, { duration: 9000 });
      router.refresh();
      return r;
    } catch {
      toast.error(describeError({ code: "E_NETWORK", message: "network" }), { duration: 9000 });
      return null;
    }
  }, [router]);
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-cream-300 bg-white/60 p-8 text-center">
      <p className="font-semibold text-stone-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-stone-500">{hint}</p>}
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, required, hint, error, children, className = "" }: {
  label: string; htmlFor?: string; required?: boolean; hint?: string; error?: string | null; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}{required && <span className="text-red-600"> *</span>}</label>
      {children}
      {error ? <p role="alert" className="mt-1 text-sm font-medium text-red-700">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl outline-none sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
