import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { login } from "./helpers";
import { USERS } from "./global-setup";

const SIZES = [
  { name: "laptop", width: 1366, height: 768 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "dien-thoai", width: 390, height: 844 },
];
fs.mkdirSync(".test-artifacts/screens", { recursive: true });

for (const s of SIZES) {
  test(`giao diện không vỡ trên ${s.name} (${s.width}×${s.height})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: s.width < 900 });
    const page = await ctx.newPage();
    await login(page, USERS.manager);
    const pages: [string, string][] = [
      ["ban", "/?date=2041-05-01"], ["danh-sach", "/dat-ban?basis=event&df=2041-05-01&dt=2041-05-01"], ["dat-moi", "/dat-ban/moi?date=2041-05-01"],
      ["tai-khoan", "/quan-ly/tai-khoan"], ["ban-quan-ly", "/quan-ly/ban"], ["nhat-ky", "/quan-ly/nhat-ky"],
    ];
    for (const [name, url] of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `.test-artifacts/screens/${s.name}-${name}.png`, fullPage: false });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${name}: trang bị cuộn ngang ${over}px`).toBeLessThanOrEqual(1);
    }
    // luồng đặt bàn trên màn hình này
    await page.goto("/dat-ban/moi?date=2041-05-01");
    await expect(page.getByTestId("pick-A1")).toBeVisible();
    await page.getByTestId("pick-A1").click();
    await expect(page.getByRole("button", { name: "Lưu lượt đặt" })).toBeVisible();
    // bảng bàn: mở ngăn chi tiết bàn
    await page.goto("/?date=2041-05-01");
    await page.getByTestId("table-B1.1").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `.test-artifacts/screens/${s.name}-chi-tiet-ban.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await ctx.close();
  });
}
