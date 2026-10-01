"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, FileText, Image as ImageIcon, Mail, MessageCircle, Share2, Smartphone } from "lucide-react";
import { cardPdf, cardPng, fileBase } from "@/lib/confirmCard";
import { fmtDate, fmtMoney, fmtTime } from "@/lib/time";
import type { Booking } from "@/lib/types";

/** Soạn sẵn tin nhắn xác nhận. Ứng dụng KHÔNG tự gửi: nhân viên bấm để mở SMS / Zalo / email trên máy của mình. */
export function buildMessage(b: Booking) {
  const lines = [
    `Nhà hàng Khoái xin xác nhận đặt bàn của ${b.customer_name ?? "quý khách"}:`,
    `• Mã đặt chỗ: ${b.code}`,
    b.event_name ? `• Tiệc: ${b.event_name}` : null,
    `• Thời gian: ${fmtTime(b.start_at)} – ${fmtTime(b.end_at)}, ngày ${fmtDate(b.start_at)}`,
    `• Số khách: ${b.party_size}${b.children_count ? ` (trong đó ${b.children_count} trẻ em)` : ""}`,
    `• Bàn: ${b.tables.map((t) => t.code).join(", ")}`,
    b.deposit_amount && Number(b.deposit_amount) > 0 ? `• Tiền đặt cọc đã ghi nhận: ${fmtMoney(b.deposit_amount)}` : null,
    b.special_requests ? `• Yêu cầu riêng: ${b.special_requests}` : null,
    "Cảm ơn quý khách, rất hân hạnh được phục vụ!",
  ];
  return lines.filter(Boolean).join("\n");
}

const toZaloNumber = (phone: string) => phone.replace(/^\+/, "").replace(/^0/, "84");

export function ConfirmMessage({ booking }: { booking: Booking }) {
  const initial = useMemo(() => buildMessage(booking), [booking]);
  const [text, setText] = useState(initial);
  const [edited, setEdited] = useState(false);
  const shown = edited ? text : initial;
  const phone = booking.customer_phone ?? "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(shown); toast.success("Đã sao chép tin nhắn."); }
    catch { toast.error("Không sao chép được — hãy bôi đen và sao chép thủ công."); }
  };
  const save = async (kind: "png" | "pdf", share = false) => {
    try {
      const blob = kind === "png" ? await cardPng(booking) : await cardPdf(booking);
      const name = `${fileBase(booking)}.${kind}`;
      const file = new File([blob], name, { type: blob.type });
      if (share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `Xác nhận đặt bàn ${booking.code}` }); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast.success(`Đã tạo file ${name}. Đính kèm file này vào tin nhắn gửi khách.`);
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error("Chưa tạo được file. Hãy thử lại.");
    }
  };
  return (
    <section className="card mx-auto max-w-4xl" aria-labelledby="confirm-msg">
      <h2 id="confirm-msg" className="mb-1 text-lg font-bold text-leaf-900">Gửi xác nhận cho khách</h2>
      <p className="mb-2 text-sm text-stone-600">Tạo <b>phiếu xác nhận</b> dạng ảnh hoặc PDF từ thông tin đã lưu, rồi đính kèm vào tin nhắn Zalo / SMS / email gửi khách. Ứng dụng không tự gửi.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => save("png")}><ImageIcon size={18} aria-hidden /> Tải ảnh PNG</button>
        <button type="button" className="btn-primary" onClick={() => save("pdf")}><FileText size={18} aria-hidden /> Tải file PDF</button>
        <button type="button" className="btn-secondary" onClick={() => save("png", true)}><Share2 size={18} aria-hidden /> Chia sẻ ảnh (điện thoại)</button>
      </div>
      <h3 className="mb-1 font-semibold">Lời nhắn kèm theo (tùy chọn)</h3>
      <textarea className="input font-mono text-sm" rows={9} value={shown} onChange={(e) => { setText(e.target.value); setEdited(true); }} aria-label="Nội dung tin nhắn xác nhận" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={copy}><Copy size={18} aria-hidden /> Sao chép</button>
        <a className={`btn-secondary ${phone ? "" : "pointer-events-none opacity-50"}`} href={phone ? `sms:${phone}?body=${encodeURIComponent(shown)}` : undefined} aria-disabled={!phone}><Smartphone size={18} aria-hidden /> Tin nhắn SMS</a>
        <a className={`btn-secondary ${phone ? "" : "pointer-events-none opacity-50"}`} href={phone ? `https://zalo.me/${toZaloNumber(phone)}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!phone}
          onClick={copy}><MessageCircle size={18} aria-hidden /> Zalo (tự sao chép nội dung)</a>
        <a className="btn-secondary" href={`mailto:?subject=${encodeURIComponent(`Xác nhận đặt bàn ${booking.code} – Nhà hàng Khoái`)}&body=${encodeURIComponent(shown)}`}><Mail size={18} aria-hidden /> Email</a>
      </div>
      {!phone && <p className="hint">Lượt đặt chưa có số điện thoại nên chưa mở được SMS / Zalo.</p>}
      <p className="hint">Email: chưa lưu địa chỉ email của khách, hãy nhập người nhận trong ứng dụng email. Với Zalo, dán nội dung vào khung chat.</p>
    </section>
  );
}
