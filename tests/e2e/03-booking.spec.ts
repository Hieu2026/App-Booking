import { expect, test } from "@playwright/test";
import { fillBooking, login, newSession } from "./helpers";
import { USERS } from "./global-setup";

test.describe.configure({ mode: "serial" });

test("tạo lượt đặt trên giao diện, thấy ngay trên bảng bàn (màu đỏ) và sau khi tải lại / đăng nhập máy khác", async ({ page, browser }) => {
  await login(page, USERS.le1);
  await page.goto("/dat-ban/moi?date=2041-06-01");
  await page.getByLabel("Giờ bắt đầu").fill("18:00");
  await page.getByLabel("Giờ kết thúc dự kiến").fill("20:00");
  await fillBooking(page, { name: "Lê Văn Bình", phone: "0912 345 678", party: "4", tables: ["A2"], event: "Họp mặt lớp" });
  await page.getByLabel("Món yêu cầu", { exact: false }).first().isVisible().catch(() => {});
  await page.getByRole("button", { name: "Thêm món" }).click();
  await page.getByLabel("Tên món 1").fill("Cá chiên");
  await page.getByLabel("Số phần món 1").fill("2");
  await page.getByLabel("Số tiền đặt cọc (VND)").fill("1500000");
  await page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await expect(page).toHaveURL(/\/dat-ban\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Lượt đặt KH-/ })).toBeVisible();
  await expect(page.getByLabel("Tên khách đặt")).toHaveValue("Lê Văn Bình");
  await expect(page.getByLabel("Số điện thoại")).toHaveValue("0912345678");
  await expect(page.getByLabel("Số tiền đặt cọc (VND)")).toHaveValue("1.500.000");
  await expect(page.getByText("Lịch sử thay đổi")).toBeVisible();
  await expect(page.getByText("Tạo lượt đặt").first()).toBeVisible();

  // máy khác (đăng nhập lại) thấy ngay
  const other = await newSession(browser, USERS.le2);
  await other.page.goto("/?date=2041-06-01");
  await expect(other.page.getByTestId("table-A2")).toHaveAttribute("data-state", "booked");
  await other.ctx.close();
  await page.reload();
  await expect(page.getByLabel("Tên khách đặt")).toHaveValue("Lê Văn Bình");
});

test("hai nhân viên cùng đặt một bàn cùng khung giờ: chỉ một thành công, người kia nhận thông báo rõ ràng", async ({ browser }) => {
  const a = await newSession(browser, USERS.le1);
  const b = await newSession(browser, USERS.le2);
  for (const [s, name] of [[a, "Khách A"], [b, "Khách B"]] as const) {
    await s.page.goto("/dat-ban/moi?date=2041-07-01");
    await s.page.getByLabel("Giờ bắt đầu").fill("18:00");
    await s.page.getByLabel("Giờ kết thúc dự kiến").fill("20:00");
    await fillBooking(s.page, { name, phone: "0900000001", party: "6", tables: ["B2.4"] });
  }
  await Promise.all([
    a.page.getByRole("button", { name: "Lưu lượt đặt" }).click(),
    b.page.getByRole("button", { name: "Lưu lượt đặt" }).click(),
  ]);
  const outcomes = await Promise.all([a, b].map(async (s) => {
    const ok = await s.page.waitForURL(/\/dat-ban\/[0-9a-f-]{36}$/, { timeout: 8000 }).then(() => true).catch(() => false);
    return ok;
  }));
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  const loser = outcomes[0] ? b : a;
  await expect(loser.page.getByRole("alert").filter({ hasText: "Vừa có người đặt trước" })).toBeVisible();
  await expect(loser.page.getByRole("alert").filter({ hasText: "B2.4" }).first()).toBeVisible();
  // dữ liệu mới nhất được tải lại: bàn B2.4 không còn chọn được
  await expect(loser.page.getByTestId("pick-B2.4")).toContainText("Trùng lịch");
  // nội dung loser đang nhập vẫn còn
  await expect(loser.page.getByLabel("Tên khách đặt")).not.toHaveValue("");
  await a.ctx.close(); await b.ctx.close();
});

test("sửa từ dữ liệu cũ không âm thầm ghi đè; nội dung đang nhập được giữ", async ({ browser }) => {
  const a = await newSession(browser, USERS.le1);
  const b = await newSession(browser, USERS.le2);
  await a.page.goto("/dat-ban/moi?date=2041-08-01");
  await a.page.getByLabel("Giờ bắt đầu").fill("12:00");
  await a.page.getByLabel("Giờ kết thúc dự kiến").fill("14:00");
  await fillBooking(a.page, { name: "Phạm Thị Cúc", phone: "0933333333", party: "4", tables: ["A4"], event: "Tên ban đầu" });
  await a.page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await expect(a.page).toHaveURL(/\/dat-ban\/[0-9a-f-]{36}$/);
  const url = a.page.url();

  await b.page.goto(url);
  await expect(b.page.getByLabel("Tên tiệc / Tên bàn đặt")).toHaveValue("Tên ban đầu");
  await b.page.getByLabel("Yêu cầu riêng").fill("Không ăn cay (do Lễ tân Lan nhập)");

  await a.page.getByLabel("Tên tiệc / Tên bàn đặt").fill("Tên do Lễ tân Mai sửa");
  await a.page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(a.page.getByText("Đã lưu thay đổi.")).toBeVisible();

  // máy B tự phát hiện (làm mới định kỳ) và báo, KHÔNG làm mất nội dung đang nhập
  await expect(b.page.getByText(/vừa sửa lượt đặt này/)).toBeVisible({ timeout: 20000 });
  await expect(b.page.getByLabel("Yêu cầu riêng")).toHaveValue("Không ăn cay (do Lễ tân Lan nhập)");

  // B bấm lưu khi vẫn dựa trên bản cũ → bị chặn, báo rõ
  await b.page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(b.page.getByRole("alert").filter({ hasText: "CHƯA được lưu" })).toBeVisible();
  await expect(b.page.getByLabel("Yêu cầu riêng")).toHaveValue("Không ăn cay (do Lễ tân Lan nhập)");
  // dữ liệu thật của A vẫn còn
  const c = await newSession(browser, USERS.manager);
  await c.page.goto(url);
  await expect(c.page.getByLabel("Tên tiệc / Tên bàn đặt")).toHaveValue("Tên do Lễ tân Mai sửa");
  await expect(c.page.getByLabel("Yêu cầu riêng")).toHaveValue("");
  await c.ctx.close();

  // B chọn dùng dữ liệu mới nhất
  await b.page.getByRole("button", { name: /Dùng dữ liệu mới nhất/ }).first().click();
  await expect(b.page.getByLabel("Tên tiệc / Tên bàn đặt")).toHaveValue("Tên do Lễ tân Mai sửa");
  await a.ctx.close(); await b.ctx.close();
});

test("mất mạng: báo CHƯA lưu, không báo thành công; có mạng lại thì lưu được", async ({ browser }) => {
  const a = await newSession(browser, USERS.le1);
  await a.page.goto("/dat-ban/moi?date=2041-09-01");
  await a.page.getByLabel("Giờ bắt đầu").fill("12:00");
  await a.page.getByLabel("Giờ kết thúc dự kiến").fill("13:00");
  await fillBooking(a.page, { name: "Khách Offline", phone: "0944444444", party: "2", tables: ["A10"] });
  await a.ctx.setOffline(true);
  await a.page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await expect(a.page.getByText(/Chưa lưu/).first()).toBeVisible();
  await expect(a.page.getByText("Đã tạo lượt đặt")).toHaveCount(0);
  await expect(a.page.getByLabel("Tên khách đặt")).toHaveValue("Khách Offline");
  await a.ctx.setOffline(false);
  await a.page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await expect(a.page).toHaveURL(/\/dat-ban\/[0-9a-f-]{36}$/);
  await a.ctx.close();
});

test("bốn phiên cùng làm việc: lượt đặt mới hiện tự động trên các máy khác", async ({ browser }) => {
  const s = await Promise.all([USERS.le1, USERS.le2, USERS.le3, USERS.le4].map((u) => newSession(browser, u)));
  for (const x of s) await x.page.goto("/?date=2041-10-01");
  for (const x of s) await expect(x.page.getByTestId("table-A7")).toHaveAttribute("data-state", "free");
  await s[0].page.goto("/dat-ban/moi?date=2041-10-01");
  await s[0].page.getByLabel("Giờ bắt đầu").fill("12:00");
  await s[0].page.getByLabel("Giờ kết thúc dự kiến").fill("14:00");
  await fillBooking(s[0].page, { name: "Khách Bốn Phiên", phone: "0955555555", party: "4", tables: ["A7"] });
  await s[0].page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await expect(s[0].page).toHaveURL(/\/dat-ban\/[0-9a-f-]{36}$/);
  for (const x of s.slice(1)) await expect(x.page.getByTestId("table-A7")).toHaveAttribute("data-state", "booked", { timeout: 20000 });
  for (const x of s) await x.ctx.close();
});

test("khách vãng lai → đang phục vụ → hoàn tất → chờ dọn → sẵn sàng", async ({ page }) => {
  await login(page, USERS.le1);
  await page.goto("/dat-ban/moi?walkin=1");
  await expect(page.getByRole("heading", { name: "Tiếp nhận khách vãng lai" })).toBeVisible();
  await page.getByLabel("Giờ bắt đầu").fill("00:05");
  await page.getByLabel("Giờ kết thúc dự kiến").fill("00:50");
  await fillBooking(page, { party: "2", tables: ["A1"] });
  await page.getByRole("button", { name: "Tiếp nhận khách" }).click();
  await expect(page).toHaveURL(/\/dat-ban\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Đã đến").first()).toBeVisible();
  const url = page.url();

  await page.goto("/");
  await expect(page.getByTestId("table-A1")).toHaveAttribute("data-state", "serving");
  await expect(page.getByTestId("table-A1")).toContainText("quá giờ");
  await page.screenshot({ path: ".test-artifacts/ban-trang-thai.png" });   // quá giờ dự kiến mà chưa kết thúc vẫn đang phục vụ

  await page.goto(url);
  await page.getByRole("button", { name: "Hoàn tất phục vụ" }).click();
  await expect(page.getByText("Đã hoàn tất — bàn chuyển sang chờ dọn.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("table-A1")).toHaveAttribute("data-state", "cleaning");
  await page.getByTestId("table-A1").click();
  await page.getByRole("button", { name: "Xác nhận sẵn sàng" }).click();
  await expect(page.getByText("Bàn A1 đã sẵn sàng.")).toBeVisible();
  await expect(page.getByTestId("table-A1")).toHaveAttribute("data-state", "free");
});

test("hủy đặt bàn cần xác nhận + lý do; giữ trong lịch sử; bàn được nhả", async ({ page }) => {
  await login(page, USERS.le1);
  await page.goto("/dat-ban/moi?date=2041-11-01");
  await page.getByLabel("Giờ bắt đầu").fill("12:00");
  await page.getByLabel("Giờ kết thúc dự kiến").fill("13:00");
  await fillBooking(page, { name: "Khách Hủy", phone: "0966666666", party: "2", tables: ["A12"] });
  await page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await expect(page).toHaveURL(/\/dat-ban\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Hủy đặt bàn" }).click();
  const confirmBtn = page.getByRole("button", { name: "Xác nhận hủy" });
  await expect(confirmBtn).toBeDisabled();
  await page.getByLabel(/Lý do hủy/).fill("Khách báo bận");
  await confirmBtn.click();
  await expect(page.getByText("Đã hủy lượt đặt.")).toBeVisible();
  await expect(page.getByText("Lý do: Khách báo bận").first()).toBeVisible();
  await page.goto("/?date=2041-11-01");
  await expect(page.getByTestId("table-A12")).toHaveAttribute("data-state", "free");
  await page.goto("/dat-ban?q=Khách Hủy&basis=event");
  await expect(page.getByRole("link", { name: /KH-/ })).toBeVisible();   // vẫn còn trong danh sách
});

test("vượt sức chứa: lễ tân bị chặn, quản lý ghi đè kèm lý do", async ({ browser }) => {
  const a = await newSession(browser, USERS.le1);
  await a.page.goto("/dat-ban/moi?date=2041-12-01");
  await a.page.getByLabel("Giờ bắt đầu").fill("12:00");
  await a.page.getByLabel("Giờ kết thúc dự kiến").fill("13:00");
  await fillBooking(a.page, { name: "Đông Khách", phone: "0977777777", party: "9", tables: ["A1"] });
  await a.page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await expect(a.page.getByRole("alert").filter({ hasText: "vượt tổng sức chứa" }).first()).toBeVisible();
  await expect(a.page.getByRole("alert").filter({ hasText: "Chỉ quản lý được ghi đè" }).first()).toBeVisible();
  await expect(a.page).toHaveURL(/moi/);
  await a.ctx.close();

  const m = await newSession(browser, USERS.manager);
  await m.page.goto("/dat-ban/moi?date=2041-12-01");
  await m.page.getByLabel("Giờ bắt đầu").fill("12:00");
  await m.page.getByLabel("Giờ kết thúc dự kiến").fill("13:00");
  await fillBooking(m.page, { name: "Đông Khách", phone: "0977777777", party: "9", tables: ["A1"] });
  await m.page.getByRole("button", { name: "Lưu lượt đặt" }).click();
  await m.page.getByLabel(/Lý do ghi đè/).fill("Kê thêm ghế, khách quen");
  await m.page.getByRole("button", { name: "Ghi đè và lưu" }).click();
  await expect(m.page).toHaveURL(/\/dat-ban\/[0-9a-f-]{36}$/);
  await expect(m.page.getByText(/Quản lý ghi đè cảnh báo — lý do: Kê thêm ghế/)).toBeVisible();
  await m.ctx.close();
});
