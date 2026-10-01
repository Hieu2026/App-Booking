export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  // Logo chữ tạm thời — không phải nhận diện thương hiệu chính thức của nhà hàng.
  return (
    <span className={`font-extrabold tracking-tight text-leaf-800 ${size === "lg" ? "text-5xl" : "text-2xl"}`} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
      Khoái<span className="text-clay-500">.</span>
    </span>
  );
}
