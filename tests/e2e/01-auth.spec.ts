import { expect, test } from "@playwright/test";
// @ts-expect-error mjs
import { sign } from "./jwt.mjs";
import { login } from "./helpers";
import { PW, USERS } from "./global-setup";

const ANON = sign({ role: "anon", iss: "mini" });

test("chưa đăng nhập: trang bị chuyển về đăng nhập, API trả 401, không đọc được dữ liệu", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dat-ban");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get("/api/availability?start=2041-01-01T10:00:00Z&end=2041-01-01T12:00:00Z")).status()).toBe(401);
  expect((await request.get("/api/export")).status()).toBe(401);
  // gọi thẳng "API dữ liệu" bằng khóa công khai, không có phiên đăng nhập
  const calls: [string, object][] = [["get_board", { p_day: "2041-05-01" }], ["search_bookings", { p_filters: {} }], ["get_context", {}],
    ["get_booking_history", { p_id: "00000000-0000-0000-0000-000000000000" }], ["get_availability", { p_start: "2041-05-01T10:00:00Z", p_end: "2041-05-01T12:00:00Z" }]];
  for (const [fn, data] of calls) {
    const r = await request.post(`http://127.0.0.1:54321/rest/v1/rpc/${fn}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "content-type": "application/json" }, data,
    });
    expect([401, 403]).toContain(r.status());
    expect(await r.text()).not.toContain("Hương");
  }
  const t = await request.get("http://127.0.0.1:54321/rest/v1/bookings?select=*", { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  expect(t.status()).not.toBe(200);
});

test("đăng nhập sai báo lỗi dễ hiểu; đúng thì vào màn hình bàn", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.le1);
  await page.getByLabel("Mật khẩu").fill("sai-mat-khau");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Email hoặc mật khẩu không đúng" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(USERS.le1);   // không mất email đã nhập
  await page.getByLabel("Mật khẩu").fill(PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: /Bàn hôm nay/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Đặt bàn mới" })).toBeVisible();
});

test("tài khoản bị khóa hoặc không có hồ sơ nhân viên: không xem được dữ liệu", async ({ browser }) => {
  for (const email of [USERS.locked, USERS.stranger]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mật khẩu").fill(PW);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page.getByRole("heading", { name: "Tài khoản chưa được cấp quyền" })).toBeVisible();
    await expect(page.getByTestId("table-A1")).toHaveCount(0);
    const r = await page.request.get("/api/availability?start=2041-01-01T10:00:00Z&end=2041-01-01T12:00:00Z");
    expect(r.status()).toBe(403);
    await ctx.close();
  }
});

test("lễ tân không vào được khu Quản lý; quản lý thì vào được", async ({ browser }) => {
  const a = await browser.newContext(); const pa = await a.newPage();
  await login(pa, USERS.le1);
  await expect(pa.getByRole("link", { name: "Quản lý" })).toHaveCount(0);
  await pa.goto("/quan-ly/tai-khoan");
  await expect(pa).toHaveURL(/\/$/);
  await a.close();
  const m = await browser.newContext(); const pm = await m.newPage();
  await login(pm, USERS.manager);
  await pm.goto("/quan-ly/tai-khoan");
  await expect(pm.getByRole("cell", { name: /Quản Lý Hoa/ })).toBeVisible();
  await pm.goto("/quan-ly/ban");
  await expect(pm.getByText(/Tầng trệt — 15 bàn, 60 chỗ/)).toBeVisible();
  await expect(pm.getByText(/Tầng 2 — 12 bàn, 89 chỗ/)).toBeVisible();
  await expect(pm.getByText(/Tầng 4 — 2 bàn, 80 chỗ/)).toBeVisible();
  await m.close();
});
