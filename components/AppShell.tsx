"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ClipboardList, LogOut, Plus, Settings2 } from "lucide-react";
import { Logo } from "./Logo";
import { ConnectionBanner, LiveProvider, useLive } from "./LiveSync";
import { signOutAction } from "@/app/actions";
import { useRouter } from "next/navigation";

function Inner({ name, role, children }: { name: string; role: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { realtime, online } = useLive();
  const nav = [
    { href: "/", label: "Bàn hôm nay", icon: CalendarDays, active: path === "/" },
    { href: "/dat-ban", label: "Danh sách & báo cáo", icon: ClipboardList, active: path === "/dat-ban" },
    ...(role === "manager" ? [{ href: "/quan-ly", label: "Quản lý", icon: Settings2, active: path.startsWith("/quan-ly") }] : []),
  ];
  return (
    <div className="min-h-dvh">
      <ConnectionBanner />
      <header className="sticky top-0 z-30 border-b border-cream-300 bg-cream-50/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-5">
          <Link href="/" aria-label="Về trang chủ"><Logo /></Link>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Điều hướng chính">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={n.active ? "page" : undefined}
                className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${n.active ? "bg-leaf-700 text-white" : "text-stone-700 hover:bg-cream-100"}`}>
                <n.icon size={18} aria-hidden /> {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/dat-ban/moi" className="btn-accent"><Plus size={20} aria-hidden /> Đặt bàn mới</Link>
            <span className="hidden items-center gap-1 text-xs text-stone-500 md:flex" title={realtime ? "Đang nhận cập nhật tức thời" : "Tự làm mới định kỳ"}>
              <span className={`h-2 w-2 rounded-full ${!online ? "bg-red-500" : realtime ? "bg-emerald-500" : "bg-amber-500"}`} />
              {!online ? "Mất mạng" : realtime ? "Trực tiếp" : "Làm mới định kỳ"}
            </span>
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div className="font-semibold">{name}</div>
              <div className="text-xs text-stone-500">{role === "manager" ? "Quản lý" : "Lễ tân / Sales"}</div>
            </div>
            <button className="btn-secondary btn-sm" aria-label="Đăng xuất" onClick={async () => { await signOutAction(); router.replace("/login"); router.refresh(); }}>
              <LogOut size={16} aria-hidden /> <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-3 py-4 sm:px-5">{children}</main>
    </div>
  );
}

export function AppShell(props: { name: string; role: string; children: React.ReactNode }) {
  return <LiveProvider><Inner {...props} /></LiveProvider>;
}
