import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { USERS } from "./global-setup";

test("ngày hiển thị dd/mm/yyyy, giờ 24 giờ; gõ tay, chọn lịch, sai ngày được xử lý", async ({ page }) => {
  await login(page, USERS.le1);
  await page.goto("/dat-ban/moi?date=2041-05-01");
  const date = page.getByLabel("Ngày diễn ra tiệc");
  await expect(date).toHaveValue("01/05/2041");
  await expect(page.getByLabel("Giờ bắt đầu")).toHaveValue(/^\d{2}:\d{2}$/);   // không AM/PM

  // gõ liền 8 chữ số → tự chèn dấu "/"
  await date.fill("");
  await date.pressSequentially("15062041");
  await expect(date).toHaveValue("15/06/2041");
  // ngày không tồn tại bị từ chối, rời ô thì trả về ngày hợp lệ trước đó
  await date.fill("31/02/2041");
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await date.blur();
  await expect(date).toHaveValue("15/06/2041");

  // giờ: gõ 4 chữ số, phím ↑ ↓ đổi 15 phút
  const from = page.getByLabel("Giờ bắt đầu");
  await from.fill("");
  await from.pressSequentially("1830");
  await expect(from).toHaveValue("18:30");
  await from.press("ArrowUp");
  await expect(from).toHaveValue("18:45");
  await from.press("ArrowDown"); await from.press("ArrowDown");
  await expect(from).toHaveValue("18:15");

  // đổi ngày thật sự ảnh hưởng tình trạng bàn (A2 đã có lượt ngày 01/06/2041 ở test khác; ở đây chỉ kiểm tra lịch chọn ngày)
  await page.getByRole("button", { name: "Mở lịch chọn ngày" }).first().click();

  // màn hình bàn + danh sách + báo cáo dùng cùng định dạng
  await page.goto("/?date=2041-05-01");
  await expect(page.getByLabel("Ngày xem")).toHaveValue("01/05/2041");
  await page.getByLabel("Ngày xem").fill("03/05/2041");
  await expect(page).toHaveURL(/date=2041-05-03/);
  await page.goto("/dat-ban?basis=event&df=2041-05-01&dt=2041-05-01");
  await expect(page.getByLabel("Từ ngày")).toHaveValue("01/05/2041");
  await expect(page.getByLabel("Đến ngày")).toHaveValue("01/05/2041");
  await expect(page.getByText("18:00 01/05/2041")).toBeVisible();   // cột ngày giờ trong bảng
  await page.screenshot({ path: ".test-artifacts/dinh-dang-ngay.png" });
});
