import { getContext } from "@/lib/data";
import { AppShell } from "@/components/AppShell";
import { Logo } from "@/components/Logo";
import { ContextProvider } from "@/components/ContextProvider";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: ctx, error } = await getContext();
  if (error || !ctx) {
    const denied = error?.code === "E_FORBIDDEN";
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="card max-w-md text-center">
          <Logo />
          <h1 className="mt-3 text-lg font-bold">{denied ? "Tài khoản chưa được cấp quyền" : "Chưa tải được dữ liệu"}</h1>
          <p className="mt-2 text-stone-600">
            {denied
              ? "Tài khoản của bạn chưa được cấp quyền sử dụng hoặc đã bị khóa. Vui lòng liên hệ quản lý."
              : "Không kết nối được với máy chủ dữ liệu. Hãy kiểm tra mạng rồi tải lại trang."}
          </p>
          <div className="mt-4 flex justify-center gap-2"><SignOutButton /></div>
        </div>
      </main>
    );
  }
  return (
    <ContextProvider value={ctx}>
      <AppShell name={ctx.me.full_name} role={ctx.me.role}>{children}</AppShell>
    </ContextProvider>
  );
}
