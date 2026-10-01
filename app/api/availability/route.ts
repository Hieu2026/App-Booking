import { NextResponse, type NextRequest } from "next/server";
import { rpc } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const start = p.get("start");
  const end = p.get("end");
  const exclude = p.get("exclude");
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)))
    return NextResponse.json({ error: "Thiếu khung giờ" }, { status: 400 });
  if (exclude && !/^[0-9a-f-]{36}$/i.test(exclude)) return NextResponse.json({ error: "Tham số không hợp lệ" }, { status: 400 });
  const r = await rpc("get_availability", { p_start: start, p_end: end, p_exclude: exclude || null });
  if (r.error) return NextResponse.json({ error: r.error.code }, { status: r.error.code === "E_FORBIDDEN" ? 403 : 502 });
  return NextResponse.json(r.data);
}
