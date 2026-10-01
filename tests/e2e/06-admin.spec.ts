import { expect, test } from "@playwright/test";
import { fillBooking, login, newSession } from "./helpers";
import { USERS } from "./global-setup";

test.describe.configure({ mode: "serial" });

test("quản lý tạo tài khoản mới, nhân viên đăng nhập được; khóa thì bị chặn", async ({ browser }) => {
  const m = await newSession(browser, USERS.manager);
  await m.page.goto("/quan-ly/tai-khoan");
  await m.page.getByRole("button", { name: "+ Tạo tài khoản" }).click();
  await m.page.getByLabel("Họ tên").fill("Nhân Viên Mới");
  await m.page.getByLabel("Email đăng nhập").fill("moi@khoai.test");
  await m.page.getByLabel(/Mật khẩu tạm/).fill("ngan");
  await m.page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();   // HTML5 chặn mật khẩu ngắn
  await expect(m.page.getByRole("cell", { name: "Nhân Viên Mới" })).toHaveCount(0);
  await m.page.getByLabel(/Mật khẩu tạm/).fill("MatKhauTam-12345");
  await m.page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect(m.page.getByRole("cell", { name: "Nhân Viên Mới" })).toBeVisible();

  const n = await browser.newContext(); const np = await n.newPage();
  await np.goto("/login");
  await np.getByLabel("Email").fill("moi@khoai.test");
  await np.getByLabel("Mật khẩu").fill("MatKhauTam-12345");
  await np.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(np.getByRole("heading", { name: /Bàn hôm nay/ })).toBeVisible();

  // quản lý khóa tài khoản
  await m.page.getByRole("row", { name: /Nhân Viên Mới/ }).getByRole("button", { name: "Sửa" }).click();
  await m.page.getByLabel(/Đang hoạt động/).uncheck();
  await m.page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(m.page.getByRole("row", { name: /Nhân Viên Mới/ })).toContainText("Đã khóa");
  await np.reload();
  await expect(np.getByRole("heading", { name: "Tài khoản chưa được cấp quyền" })).toBeVisible();
  await n.close();

  // không tự khóa mình
  await m.page.getByRole("row", { name: /Quản Lý Hoa/ }).getByRole("button", { name: "Sửa" }).click();
  await m.page.getByLabel(/Đang hoạt động/).uncheck();
  await m.page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(m.page.getByText(/không thể tự hạ quyền/)).toBeVisible();
  await m.ctx.close();
});

test("quản lý sửa bàn, danh mục, cấu hình; nhật ký ghi lại và không sửa được", async ({ browser }) => {
  const m = await newSession(browser, USERS.manager);
  await m.page.goto("/quan-ly/ban");
  await m.page.getByRole("button", { name: "+ Thêm bàn" }).click();
  await m.page.getByLabel("Mã bàn").fill("  Z1  ");
  await m.page.getByLabel("Sức chứa").fill("6");
  await m.page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(m.page.getByRole("cell", { name: "Z1", exact: true })).toBeVisible();
  // mã trùng bị từ chối
  await m.page.getByRole("button", { name: "+ Thêm bàn" }).click();
  await m.page.getByLabel("Mã bàn").fill("A1");
  await m.page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(m.page.getByText("Mã bàn này đã tồn tại.")).toBeVisible();
  await m.page.keyboard.press("Escape");

  await m.page.goto("/quan-ly/danh-muc");
  await expect(m.page.getByText(/đề xuất ban đầu/)).toBeVisible();
  await m.page.getByLabel("Thêm vào Nguồn khách").fill("TikTok");
  await m.page.getByRole("button", { name: "Thêm" }).first().click();
  await expect(m.page.getByLabel("Tên mục").and(m.page.locator('input[value="TikTok"]'))).toBeVisible();

  await m.page.goto("/quan-ly/cau-hinh");
  await m.page.getByLabel(/Khoảng đệm dọn bàn/).fill("15");
  await m.page.getByRole("button", { name: "Lưu cấu hình" }).click();
  await expect(m.page.getByText("Đã lưu cấu hình.")).toBeVisible();
  await m.page.getByLabel(/Khoảng đệm dọn bàn/).fill("0");
  await m.page.getByRole("button", { name: "Lưu cấu hình" }).click();

  await m.page.goto("/quan-ly/nhat-ky");
  await expect(m.page.getByText("Thêm bàn Z1")).toBeVisible();
  await expect(m.page.getByText("Đổi cấu hình").first()).toBeVisible();
  await expect(m.page.getByText(/chỉ xem, không sửa được/)).toBeVisible();
  await m.ctx.close();
});

test("vận hành bàn: tạm ngưng / mở lại; đổi bàn, thêm-bớt bàn trên lượt đặt; khoảng đệm dọn bàn", async ({ page }) => {
  await login(page, USERS.le1);
  // tạm ngưng bàn A13 → không chọn được khi đặt
  await page.goto("/?date=2042-01-10");
  await page.getByTestId("table-A13").click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Tạm ngưng bàn" }).click();
  await expect(page.getByTestId("table-A13")).toHaveAttribute("data-state", "suspended");
  await page.goto("/dat-ban/moi?date=2042-01-10");
  await page.getByLabel("Giờ bắt đầu").fill("12:00");
  await page.getByLabel("Giờ kết thúc dự kiến").fill("13:00");
  await expect(page.getByTestId("pick-A13")).toBeDisabled();
  await page.goto("/?date=2042-01-10");
  await page.getByTestId("table-A13").click();
  await page.getByRole("button", { name: "Mở lại bàn" }).click();
  await expect(page.getByTestId("table-A13")).toHaveAttribute("data-state", "free");

  // tạo lượt đặt 2 bàn rồi thêm/bớt, đổi bàn
  await page.goto("/dat-ban/moi?date=2042-01-10");
  await page.getByLabel("Giờ bắt đầu").fill("12:00");
  await page.getByLabel("Giờ kết thúc dự kiến").fill("14:00");
  await fillBooking(page, { name: "Khách Hai Bàn", phone: "0988888888", party: "8", tables: ["A1", "A2"] });
  await expect(page.getByText(/Số bàn: 2/)).toBeVisible();
  await page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await expect(page).toHaveURL(/\/dat-ban\/[0-9a-f-]{36}$/);
  // bớt A2, thêm A3
  await page.getByTestId("pick-A2").click();
  await page.getByTestId("pick-A3").click();
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByText("Đã lưu thay đổi.")).toBeVisible();
  await expect(page.getByText("Bàn: A1, A2 → A1, A3").or(page.getByText(/Bàn:.*A3/)).first()).toBeVisible();
  // đổi bàn nhanh A3 → A4
  await page.getByRole("button", { name: "Chuyển bàn A3…" }).click();
  await page.getByRole("dialog").getByTestId("pick-A4").click();
  await expect(page.getByText("Đã chuyển bàn.")).toBeVisible();
  await expect(page.getByTestId("pick-A4")).toHaveAttribute("aria-pressed", "true");
  // bàn A2 được nhả ngay
  await page.goto("/?date=2042-01-10");
  await expect(page.getByTestId("table-A2")).toHaveAttribute("data-state", "free");
  await expect(page.getByTestId("table-A4")).toHaveAttribute("data-state", "booked");
});

test("soạn tin nhắn xác nhận cho khách", async ({ page }) => {
  await login(page, USERS.le1);
  await page.goto("/dat-ban?basis=event&q=Khách Hai Bàn");
  await page.getByRole("link", { name: /KH-/ }).first().click();
  const box = page.getByLabel("Nội dung tin nhắn xác nhận");
  await expect(box).toContainText("Nhà hàng Khoái xin xác nhận đặt bàn của Khách Hai Bàn");
  await expect(box).toContainText("Bàn: A1, A4");
  await expect(page.getByRole("link", { name: /Tin nhắn SMS/ })).toHaveAttribute("href", /^sms:0988888888\?body=/);
  await expect(page.getByRole("link", { name: /Zalo/ })).toHaveAttribute("href", "https://zalo.me/84988888888");
});

test("tạo phiếu xác nhận dạng PNG và PDF để đính kèm", async ({ page }) => {
  await login(page, USERS.le1);
  await page.goto("/dat-ban?basis=event&q=Khách Hai Bàn");
  await page.getByRole("link", { name: /KH-/ }).first().click();
  const readFile = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
    const path = await dl.path();
    return { name: dl.suggestedFilename(), buf: (await import("node:fs")).readFileSync(path!) };
  };
  const png = await readFile("Tải ảnh PNG");
  expect(png.name).toMatch(/^xac-nhan-KH-\d{5}\.png$/);
  expect([...png.buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const pdf = await readFile("Tải file PDF");
  expect(pdf.name).toMatch(/\.pdf$/);
  expect(pdf.buf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.buf.subarray(-6).toString()).toContain("%%EOF");
  (await import("node:fs")).mkdirSync(".test-artifacts", { recursive: true });
  (await import("node:fs")).writeFileSync(".test-artifacts/phieu.png", png.buf);
  (await import("node:fs")).writeFileSync(".test-artifacts/phieu.pdf", pdf.buf);
});
