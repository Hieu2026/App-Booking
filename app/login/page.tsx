import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-cream-100 to-cream-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo size="lg" />
          <p className="mt-1 text-stone-600">Quản lý bàn &amp; đặt tiệc</p>
        </div>
        <div className="card">
          <h1 className="mb-4 text-lg font-bold">Đăng nhập nhân viên</h1>
          <LoginForm />
          <p className="hint mt-4">Chưa có tài khoản? Nhờ quản lý tạo tài khoản riêng cho bạn. Ứng dụng không mở đăng ký công khai.</p>
        </div>
      </div>
    </main>
  );
}
