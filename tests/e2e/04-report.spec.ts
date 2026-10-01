import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { login } from "./helpers";
import { USERS } from "./global-setup";

test("tìm kiếm, chọn cột, sắp xếp và xuất Excel đúng (không đếm trùng, giữ số 0 đầu, chặn công thức)", async ({ page }) => {
  await login(page, USERS.le1);
  await page.goto("/dat-ban?basis=event&df=2041-05-01&dt=2041-05-01");
  await expect(page.getByRole("link", { name: /KH-/ })).toHaveCount(1);
  await expect(page.getByText("0987654321")).toBeVisible();
  await expect(page.getByText("B1.1, B1.10")).toBeVisible();

  // tìm theo nhiều trường
  for (const q of ["huong", "0987 654", "thoi noi", "B1.10", "=HD-001"]) {
    await page.goto(`/dat-ban?basis=event&q=${encodeURIComponent(q)}`);
    await expect(page.getByText("Trần Thị Hương")).toBeVisible();
  }
  await page.goto("/dat-ban?basis=event&q=khong-co-ai");
  await expect(page.getByText("Không có lượt đặt nào khớp")).toBeVisible();

  // tổng ở cấp lượt đặt
  await page.goto("/dat-ban?basis=event&df=2041-05-01&dt=2041-05-01");
  const bar = page.getByTestId("totals");
  await expect(bar).toContainText("1 lượt đặt");
  await expect(bar).toContainText("28 khách");
  await expect(bar).toContainText("3.000.000");

  // ngày theo "ngày khách đặt"
  await page.goto("/dat-ban?basis=booked&df=2041-04-20&dt=2041-04-20");
  await expect(page.getByText("Trần Thị Hương")).toBeVisible();
  await page.goto("/dat-ban?basis=booked&df=2041-05-01&dt=2041-05-01");
  await expect(page.getByText("Không có lượt đặt nào khớp")).toBeVisible();

  // sắp xếp
  await page.goto("/dat-ban?basis=event&df=2041-05-01&dt=2041-12-31&sort=customer_name&dir=desc");
  const names = await page.locator("tbody tr td:nth-child(3)").allTextContents();
  expect([...names].sort().reverse().map((n) => n.trim())).toEqual(names.map((n) => n.trim()));

  // xuất Excel với cột người dùng chọn
  const res = await page.request.get("/api/export?basis=event&df=2041-05-01&dt=2041-05-01&cols=code,customer_phone,customer_name,tables,party_size,deposit_amount,contract_code,special_requests,start_at,items");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("spreadsheetml");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.body());
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Đặt bàn", "Chi tiết bàn", "Món yêu cầu", "Bộ lọc"]);
  const ws = wb.getWorksheet("Đặt bàn")!;
  const header = (ws.getRow(1).values as string[]).slice(1);
  expect(header).toEqual(["Mã đặt chỗ", "Số điện thoại", "Tên khách đặt", "Bàn", "Số lượng khách", "Số tiền đặt cọc (VND)", "Mã HĐ", "Yêu cầu riêng", "Ngày giờ diễn ra", "Món yêu cầu"]);
  const row = ws.getRow(2);
  const phone = row.getCell(2);
  expect(phone.type).toBe(ExcelJS.ValueType.String);
  expect(phone.value).toBe("0987654321");
  expect(row.getCell(4).value).toBe("B1.1, B1.10");
  expect(row.getCell(5).value).toBe(28);
  expect(row.getCell(6).value).toBe(3000000);
  expect(row.getCell(6).numFmt).toBe("#,##0");
  // nội dung có thể thành công thức bị vô hiệu hóa
  expect(String(row.getCell(7).value).startsWith("'=")).toBe(true);
  expect(String(row.getCell(8).value).startsWith("'=")).toBe(true);
  expect(row.getCell(7).type).toBe(ExcelJS.ValueType.String);
  expect((row.getCell(9).value as Date).toISOString()).toBe("2041-05-01T18:00:00.000Z"); // giờ tường 18:00 (giờ VN), không lệch múi giờ
  // chỉ 1 dòng dữ liệu, tổng không nhân lên theo số bàn / số món
  const labels: Record<string, unknown> = {};
  ws.eachRow((r) => { const a = r.getCell(1).value; if (typeof a === "string" && a.startsWith("TỔNG")) labels[a] = r.getCell(2).value; });
  expect(labels).toEqual({ "TỔNG SỐ LƯỢT ĐẶT": 1, "TỔNG SỐ KHÁCH": 28, "TỔNG TIỀN CỌC (VND, chỉ để theo dõi)": 3000000 });
  expect(wb.getWorksheet("Chi tiết bàn")!.rowCount).toBe(3);   // tiêu đề + 2 bàn
  expect(wb.getWorksheet("Món yêu cầu")!.rowCount).toBe(4);    // tiêu đề + 3 món
});
