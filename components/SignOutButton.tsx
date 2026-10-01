"use client";
import { useRouter } from "next/navigation";
import { signOutAction } from "@/app/actions";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button className="btn-secondary" onClick={async () => { await signOutAction(); router.replace("/login"); router.refresh(); }}>
      Đăng xuất
    </button>
  );
}
