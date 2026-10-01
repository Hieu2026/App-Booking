import Image from "next/image";

/** Logo nhà hàng Khoái (file public/logo.png). */
export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const h = size === "lg" ? 150 : 44;
  return (
    <Image src="/logo.png" alt="Khoái — Hải sản & đặc sản Nha Trang" width={Math.round((h * 582) / 601)} height={h} priority
      className="inline-block w-auto" style={{ height: h }} />
  );
}
