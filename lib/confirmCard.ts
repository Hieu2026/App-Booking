import { fmtDate, fmtMoney, fmtTime } from "./time";
import type { Booking } from "./types";

// Tạo "phiếu xác nhận đặt bàn" dạng ảnh (PNG) hoặc PDF ngay trên trình duyệt để nhân viên đính kèm gửi khách.
// Chỉ dùng thông tin có trong lượt đặt; không tự thêm địa chỉ/số điện thoại nhà hàng.

const W = 1080, PAD = 64, GREEN = "#b8000c", CLAY = "#de000f", INK = "#2b2523", MUTE = "#78716c";
const FONT = `"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`;

export function cardRows(b: Booking): [string, string][] {
  const rows: [string, string | null][] = [
    ["Khách hàng", b.customer_name],
    ["Số điện thoại", b.customer_phone],
    ["Tên tiệc", b.event_name],
    ["Ngày", fmtDate(b.start_at)],
    ["Giờ", `${fmtTime(b.start_at)} – ${fmtTime(b.end_at)}`],
    ["Bàn", b.tables.map((t) => t.code).join(", ")],
    ["Số khách", `${b.party_size}${b.children_count ? ` (trong đó ${b.children_count} trẻ em)` : ""}`],
    ["Mục đích", b.purpose_label],
    ["Trang trí bàn tiệc", b.decoration],
    ["Món yêu cầu", b.items.length ? b.items.map((i) => `${i.name} × ${i.qty}${i.note ? ` (${i.note})` : ""}`).join("\n") : null],
    ["Tiền đặt cọc", b.deposit_amount && Number(b.deposit_amount) > 0 ? `${fmtMoney(b.deposit_amount)}${b.deposit_method_label ? ` · ${b.deposit_method_label}` : ""}` : null],
    ["Yêu cầu riêng", b.special_requests],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = "/logo.png";
  });
}

export async function renderCard(b: Booking): Promise<HTMLCanvasElement> {
  const logo = await loadLogo();
  const rows = cardRows(b);
  const canvas = document.createElement("canvas");
  const probe = canvas.getContext("2d")!;
  const LX = PAD + 24, VX = PAD + 300, VW = W - PAD - 24 - VX, LH = 40;
  probe.font = `30px ${FONT}`;
  const wrapped = rows.map(([, v]) => wrap(probe, v, VW));
  const bodyH = wrapped.reduce((s, l) => s + l.length * LH + 22, 0);
  const TOP = 240, BOX = TOP + 120;
  const H = BOX + bodyH + 10 + 70 + 150;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fffbf9"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, TOP);
  ctx.fillStyle = CLAY; ctx.fillRect(0, TOP, W, 12);
  let tx = PAD;
  if (logo) { const lh = 196, lw = Math.round((lh * logo.width) / logo.height); ctx.drawImage(logo, PAD, 22, lw, lh); tx = PAD + lw + 40; }
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = CLAY; ctx.font = `bold 46px ${FONT}`; ctx.fillText("PHIẾU XÁC NHẬN", tx, 100);
  ctx.fillText("ĐẶT BÀN", tx, 156);
  ctx.fillStyle = MUTE; ctx.font = `26px ${FONT}`; ctx.fillText("Nhà hàng Khoái · Hải sản & đặc sản Nha Trang", tx, 202);

  ctx.fillStyle = INK; ctx.font = `bold 40px ${FONT}`;
  ctx.fillText(`Mã đặt chỗ: ${b.code}`, PAD, TOP + 80);
  let y = BOX;
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#eccfc6"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(PAD, y, W - 2 * PAD, bodyH + 10, 20); ctx.fill(); ctx.stroke();
  y += 22;
  rows.forEach(([label], i) => {
    ctx.font = `bold 28px ${FONT}`; ctx.fillStyle = GREEN; ctx.fillText(label, LX, y + 30);
    ctx.font = `30px ${FONT}`; ctx.fillStyle = INK;
    wrapped[i].forEach((ln, k) => ctx.fillText(ln, VX, y + 30 + k * LH));
    y += wrapped[i].length * LH + 22;
    if (i < rows.length - 1) { ctx.strokeStyle = "#f6e0da"; ctx.beginPath(); ctx.moveTo(LX, y - 10); ctx.lineTo(W - PAD - 24, y - 10); ctx.stroke(); }
  });
  y = BOX + bodyH + 10 + 80;
  ctx.fillStyle = INK; ctx.font = `italic 30px ${FONT}`;
  ctx.fillText("Cảm ơn quý khách, rất hân hạnh được phục vụ!", PAD, y);
  ctx.fillStyle = MUTE; ctx.font = `24px ${FONT}`;
  ctx.fillText("Tiền đặt cọc (nếu có) chỉ ghi nhận để theo dõi.", PAD, y + 48);
  ctx.fillText("Cần thay đổi, vui lòng báo trước cho nhà hàng.", PAD, y + 82);
  return canvas;
}

export const fileBase = (b: Booking) => `xac-nhan-${b.code}`;

export async function cardPng(b: Booking): Promise<Blob> {
  const canvas = await renderCard(b);
  return new Promise((res, rej) => canvas.toBlob((x) => (x ? res(x) : rej(new Error("png"))), "image/png"));
}

/** PDF 1 trang chứa ảnh phiếu (JPEG nhúng), kích thước theo ảnh. */
export async function cardPdf(b: Booking): Promise<Blob> {
  const canvas = await renderCard(b);
  const jpg = Uint8Array.from(atob(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]), (c) => c.charCodeAt(0));
  const pw = Math.round(canvas.width * 0.5), ph = Math.round(canvas.height * 0.5);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (d: Uint8Array | string) => { const u = typeof d === "string" ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n: number, body: string | Uint8Array[]) => {
    offsets[n] = len; push(`${n} 0 obj\n`);
    if (typeof body === "string") push(body); else body.forEach(push);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [enc.encode(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, enc.encode("\nendstream")]);
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => String(offsets[n]).padStart(10, "0") + " 00000 n \n").join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}
