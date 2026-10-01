"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";

interface Live { tick: number; online: boolean; realtime: boolean }
const LiveCtx = createContext<Live>({ tick: 0, online: true, realtime: false });
export const useLive = () => useContext(LiveCtx);

const POLL = Math.max(5, Number(process.env.NEXT_PUBLIC_POLL_SECONDS ?? 20)) * 1000;

/**
 * Giữ dữ liệu luôn mới trên mọi máy:
 *  - Lắng nghe thay đổi realtime (RLS áp dụng cho kênh này);
 *  - Tự làm mới định kỳ khi mất kênh realtime, khi quay lại tab hoặc khi có mạng trở lại.
 * Làm mới chỉ nạp lại dữ liệu từ máy chủ, không đặt lại các ô đang nhập.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const [online, setOnline] = useState(true);
  const [realtime, setRealtime] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { router.refresh(); setTick((t) => t + 1); }, 250);
  }, [router]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); refresh(); };
    const off = () => setOnline(false);
    const vis = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", vis);
    const poll = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) refresh(); }, POLL);

    let channel: ReturnType<ReturnType<typeof getBrowserClient>["channel"]> | null = null;
    try {
      const sb = getBrowserClient();
      channel = sb.channel("khoai-live");
      for (const table of ["bookings", "booking_tables", "dining_tables", "booking_items"]) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
      }
      channel.subscribe((status: string) => setRealtime(status === "SUBSCRIBED"));
    } catch {
      setRealtime(false);
    }
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      try { if (channel) getBrowserClient().removeChannel(channel); } catch { /* bỏ qua */ }
    };
  }, [refresh]);

  return <LiveCtx.Provider value={{ tick, online, realtime }}>{children}</LiveCtx.Provider>;
}

export function ConnectionBanner() {
  const { online } = useLive();
  if (online) return null;
  return (
    <div role="alert" className="sticky top-0 z-40 bg-red-700 px-4 py-2 text-center text-sm font-semibold text-white">
      Mất kết nối mạng — dữ liệu có thể chưa mới và thao tác lưu sẽ CHƯA được ghi nhận. Dữ liệu đang nhập vẫn được giữ trên màn hình.
    </div>
  );
}
