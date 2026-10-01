"use client";
import { useRouter } from "next/navigation";

export function RetryCard({ message }: { message: string }) {
  const router = useRouter();
  return (
    <div role="alert" className="card mx-auto max-w-md text-center">
      <p className="font-semibold text-red-800">Có lỗi</p>
      <p className="mt-1 text-stone-600">{message}</p>
      <button className="btn-primary mt-3" onClick={() => router.refresh()}>Thử lại</button>
    </div>
  );
}
