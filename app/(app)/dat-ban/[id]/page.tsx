import { notFound } from "next/navigation";
import { rpc } from "@/lib/data";
import type { Booking } from "@/lib/types";
import { BookingForm } from "@/components/BookingForm";
import { ConfirmMessage } from "@/components/ConfirmMessage";
import { HistoryPanel } from "@/components/HistoryPanel";
import { RetryCard } from "@/components/RetryCard";

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data, error } = await rpc<Booking>("get_booking", { p_id: id });
  if (error?.code === "E_NOT_FOUND") notFound();
  if (error || !data) return <RetryCard message="Chưa tải được lượt đặt. Hãy kiểm tra mạng rồi thử lại." />;
  return (
    <div className="space-y-4">
      <BookingForm key={data.id} booking={data} />
      {["pending", "confirmed", "arrived"].includes(data.status) && <ConfirmMessage booking={data} key={data.version} />}
      <HistoryPanel bookingId={data.id} version={data.version} />
    </div>
  );
}
