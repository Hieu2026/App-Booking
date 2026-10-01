import { expect, type Browser, type Page } from "@playwright/test";
import { PW } from "./global-setup";

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/($|\?)/);
}

export async function newSession(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email);
  return { ctx, page };
}

export async function fillBooking(page: Page, o: { name?: string; phone?: string; party?: string; tables: string[]; event?: string }) {
  if (o.name !== undefined) await page.getByLabel("Tên khách đặt").fill(o.name);
  if (o.phone !== undefined) await page.getByLabel("Số điện thoại").fill(o.phone);
  if (o.event) await page.getByLabel("Tên tiệc / Tên bàn đặt").fill(o.event);
  await page.getByLabel(/^Số lượng khách/).fill(o.party ?? "4");
  for (const t of o.tables) {
    const b = page.getByTestId(`pick-${t}`);
    await expect(b).toBeEnabled();
    await b.click();
  }
}
