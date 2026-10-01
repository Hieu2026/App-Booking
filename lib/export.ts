import ExcelJS from "exceljs";
import { COLUMNS, COL_BY_KEY, type Col } from "./columns";
import { fmtDate, fmtDateTime, vnParts, wallDate } from "./time";
import type { Booking } from "./types";

/** Chặn Excel diễn giải chữ nhập tự do thành công thức. */
export function safeText(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export interface ExportOptions {
  cols: string[];
  filterLines: [string, string][];
  exportedBy: string;
  floorName: (code: string) => string;
}

export async function buildWorkbook(rows: Booking[], totals: { total: number; guests: number; deposit: number }, o: ExportOptions) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Khoái — Quản lý bàn & đặt tiệc";
  wb.created = new Date();
  const head = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5A44" } };
    r.alignment = { vertical: "middle", wrapText: true };
    r.height = 30;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  // ---- Sheet 1: Đặt bàn — mỗi lượt đặt đúng 1 dòng
  const keys = o.cols.includes("code") ? o.cols : ["code", ...o.cols];
  const cols: Col[] = keys.map((k) => COL_BY_KEY.get(k)).filter((c): c is Col => !!c);
  const ws = wb.addWorksheet("Đặt bàn");
  ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: c.width ?? 16 }));
  head(ws);
  for (const b of rows) {
    const row = ws.addRow({});
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = c.value(b);
      if (v === null || v === "") return;
      switch (c.kind) {
        case "phone": cell.value = String(v); cell.numFmt = "@"; break;     // giữ số 0 đầu, luôn là văn bản
        case "money": cell.value = Number(v); cell.numFmt = "#,##0"; break;
        case "int": cell.value = Number(v); cell.numFmt = "0"; break;
        case "datetime": cell.value = wallDate(String(v)); cell.numFmt = "dd/mm/yyyy hh:mm"; break;
        case "date": { const p = String(v).split("-").map(Number); cell.value = new Date(Date.UTC(p[0], p[1] - 1, p[2])); cell.numFmt = "dd/mm/yyyy"; break; }
        default: cell.value = safeText(v); cell.numFmt = "@"; cell.alignment = { wrapText: true, vertical: "top" };
      }
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  // Tổng tính ở cấp LƯỢT ĐẶT (mỗi lượt đúng một lần), không nhân theo số bàn / số món.
  ws.addRow([]);
  const lines: [string, number, string][] = [
    ["TỔNG SỐ LƯỢT ĐẶT", totals.total, "0"], ["TỔNG SỐ KHÁCH", totals.guests, "0"], ["TỔNG TIỀN CỌC (VND, chỉ để theo dõi)", totals.deposit, "#,##0"],
  ];
  for (const [label, val, fmt] of lines) {
    const r = ws.addRow([]);
    r.getCell(1).value = label; r.getCell(1).font = { bold: true };
    r.getCell(2).value = val; r.getCell(2).numFmt = fmt; r.getCell(2).font = { bold: true };
  }

  // ---- Sheet 2: Chi tiết bàn — mỗi bàn của mỗi lượt đặt 1 dòng
  const wt = wb.addWorksheet("Chi tiết bàn");
  wt.columns = [
    { header: "Mã đặt chỗ", key: "a", width: 14 }, { header: "Tên khách đặt", key: "b", width: 22 },
    { header: "Ngày giờ diễn ra", key: "c", width: 18 }, { header: "Tầng / khu", key: "d", width: 14 },
    { header: "Mã bàn", key: "e", width: 12 }, { header: "Sức chứa", key: "f", width: 10 },
  ];
  head(wt);
  for (const b of rows) for (const t of b.tables) {
    const r = wt.addRow([b.code, safeText(b.customer_name ?? (b.is_walk_in ? "Khách vãng lai" : "")), wallDate(b.start_at), o.floorName(t.floor_code), safeText(t.code), t.capacity]);
    r.getCell(3).numFmt = "dd/mm/yyyy hh:mm"; r.getCell(5).numFmt = "@";
  }

  // ---- Sheet 3: Món yêu cầu — mỗi món 1 dòng
  const wi = wb.addWorksheet("Món yêu cầu");
  wi.columns = [
    { header: "Mã đặt chỗ", key: "a", width: 14 }, { header: "Tên khách đặt", key: "b", width: 22 },
    { header: "Tên món", key: "c", width: 28 }, { header: "Số phần", key: "d", width: 10 }, { header: "Ghi chú", key: "e", width: 30 },
  ];
  head(wi);
  for (const b of rows) for (const i of b.items) wi.addRow([b.code, safeText(b.customer_name ?? ""), safeText(i.name), i.qty, safeText(i.note ?? "")]);

  // ---- Sheet 4: Bộ lọc đã dùng
  const wf = wb.addWorksheet("Bộ lọc");
  wf.columns = [{ width: 28 }, { width: 60 }];
  const now = new Date();
  for (const [k, v] of [["Xuất lúc", fmtDateTime(now.toISOString())], ["Người xuất", o.exportedBy], ...o.filterLines] as [string, string][]) {
    const r = wf.addRow([k, safeText(v)]);
    r.getCell(1).font = { bold: true };
  }
  wf.addRow(["Múi giờ", "Asia/Ho_Chi_Minh (giờ Việt Nam)"]).getCell(1).font = { bold: true };
  void fmtDate; void vnParts;
  return wb;
}
