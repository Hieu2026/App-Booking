import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Khoái — Quản lý bàn & đặt tiệc",
  description: "Ứng dụng nội bộ quản lý bàn và đặt tiệc của nhà hàng.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        {children}
        <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontSize: "15px" } }} />
      </body>
    </html>
  );
}
