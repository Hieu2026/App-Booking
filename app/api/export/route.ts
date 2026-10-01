import { NextResponse, type NextRequest } from "next/server";
import { getContext, rpc } from "@/lib/data";
import { buildWorkbook } from "@/lib/export";
import { parseSearch } from "@/lib/search";
import { fmtDate, todayVn } from "@/lib/time";
import { BOOKING_STATUS } from "@/lib/labels";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const p = parseSearch(sp);
  const [ctx, res] = await Promise.all([
    getContext(),
    rpc<{ total: number; total_guests: number; total_deposit: string | number; rows: Booking[] }>("search_bookings", {
      p_filters: p.filters, p_sort: p.sort, p_dir: p.dir, p_limit: null, p_offset: 0,
    }),
  ]);
  if (ctx.error || !ctx.data) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  if (res.error || !res.data) return NextResponse.json({ error: "Không xuất được báo cáo" }, { status: 502 });

  const c = ctx.data;
  const r = p.raw;
  const name = (list: { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? "";
  const lines: [string, string][] = [
    ["Tính ngày theo", r.basis === "booked" ? "Ngày khách đặt bàn / đặt tiệc" : "Ngày diễn ra tiệc"],
    ["Từ ngày", r.df ? fmtDate(r.df) : "(không giới hạn)"], ["Đến ngày", r.dt ? fmtDate(r.dt) : "(không giới hạn)"],
    ["Từ khóa", r.q || "(không)"], ["Tầng / khu", c.floors.find((f) => f.code === r.floor)?.name ?? "(tất cả)"],
    ["Nhân viên tư vấn", c.staff.find((s) => s.id === r.consultant)?.full_name ?? "(tất cả)"],
    ["Nguồn khách", name(c.lookups, r.source) || "(tất cả)"], ["Mục đích tiệc", name(c.lookups, r.purpose) || "(tất cả)"],
    ["Trạng thái", r.status.length ? r.status.map((s) => BOOKING_STATUS[s].label).join(", ") : "(tất cả)"],
    ["Tình trạng cọc", r.deposit === "has" ? "Đã cọc" : r.deposit === "none" ? "Chưa cọc" : "(tất cả)"],
    ["Sắp xếp", `${p.sort} (${p.dir === "asc" ? "tăng dần" : "giảm dần"})`],
  ];
  const wb = await buildWorkbook(res.data.rows, {
    total: res.data.total, guests: res.data.total_guests, deposit: Number(res.data.total_deposit),
  }, { cols: p.cols, filterLines: lines, exportedBy: c.me.full_name, floorName: (code) => c.floors.find((f) => f.code === code)?.name ?? code });
  const buf = await wb.xlsx.writeBuffer();
  const file = `khoai-dat-ban-${todayVn()}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
