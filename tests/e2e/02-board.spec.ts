import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { USERS } from "./global-setup";

test("màn hình bàn: đủ 29 bàn, tổng từng tầng, bộ lọc, thống kê, chế độ xem", async ({ page }) => {
  await login(page, USERS.le1);
  await page.goto("/?date=2041-05-01&from=10:00&to=22:00");
  await expect(page.locator('[data-testid^="table-"]')).toHaveCount(29);
  await expect(page.getByText("15 bàn · 60 chỗ")).toBeVisible();
  await expect(page.getByText("12 bàn · 89 chỗ")).toBeVisible();
  await expect(page.getByText("2 bàn · 80 chỗ")).toBeVisible();
  for (const c of ["STT", "STN", "VIP 4", "B1.1", "B1.10"]) await expect(page.getByTestId(`table-${c}`)).toBeVisible();

  // bàn đã có khách đặt (2 bàn của tiệc mẫu) tô đỏ + có chữ
  for (const c of ["B1.1", "B1.10"]) {
    const card = page.getByTestId(`table-${c}`);
    await expect(card).toHaveAttribute("data-state", "booked");
    await expect(card).toContainText("Có khách đặt");
    await expect(card).toContainText("18:00–21:00");
    await expect(card).toHaveClass(/border-red-600/);
  }
  await expect(page.getByTestId("table-A1")).toHaveAttribute("data-state", "free");

  // khung giờ không giao với tiệc → B1.1 trống
  await page.getByLabel("Từ giờ").fill("10:00");
  await page.getByLabel("Đến giờ").fill("17:00");
  await expect(page.getByTestId("table-B1.1")).toHaveAttribute("data-state", "free");
  await page.getByLabel("Đến giờ").fill("18:30");
  await expect(page.getByTestId("table-B1.1")).toHaveAttribute("data-state", "booked");

  // màu theo tầng: trệt #70bf54 (fresh), tầng 2 #f47a63 (coral), tầng 4 #4aa6de (ocean)
  await expect(page.getByTestId("table-A1")).toHaveClass(/border-fresh-500/);
  await expect(page.getByTestId("table-A1")).toHaveClass(/border-l-fresh-500/);
  await expect(page.getByTestId("table-VIP 1")).toHaveClass(/border-coral-500/);
  await expect(page.getByTestId("table-STT")).toHaveClass(/border-ocean-400/);
  // bàn có khách đặt ở tầng 2: nền đỏ nhưng viền trái vẫn là màu tầng 2
  await expect(page.getByTestId("table-B1.1")).toHaveClass(/border-l-coral-500/);
  await expect(page.getByTestId("table-B1.1")).toHaveClass(/border-red-600/);
  const colors = async (id: string) => page.getByTestId(id).evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopColor, c.borderLeftColor, c.backgroundColor]; });
  expect((await colors("table-A1"))[0]).toBe("rgb(112, 191, 84)");       // #70bf54
  expect((await colors("table-VIP 1"))[0]).toBe("rgb(244, 122, 99)");     // #f47a63
  expect((await colors("table-STT"))[0]).toBe("rgb(74, 166, 222)");       // #4aa6de
  expect((await colors("table-B1.1"))[1]).toBe("rgb(244, 122, 99)");      // viền trái tầng 2

  // thống kê: 27 trống, 2 có lịch; 1 lượt, 28 khách
  await page.getByRole("button", { name: "Cả ngày" }).click();
  await expect(page.getByLabel("Thống kê")).toContainText("27");
  await expect(page.getByLabel("Thống kê")).toContainText("28");

  // lọc tầng + sức chứa + trạng thái
  await page.getByLabel("Tầng", { exact: true }).selectOption("T4");
  await expect(page.locator('[data-testid^="table-"]')).toHaveCount(2);
  await page.getByLabel("Tầng", { exact: true }).selectOption("");
  await page.getByLabel("Sức chứa").selectOption("15");
  await expect(page.locator('[data-testid^="table-"]')).toHaveCount(4); // B1.1, B1.10, STT, STN
  await page.getByLabel("Sức chứa").selectOption("0");
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("booked");
  await expect(page.locator('[data-testid^="table-"]')).toHaveCount(2);
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("");

  // bấm bàn → xem lịch trong ngày
  await page.getByTestId("table-B1.1").click();
  await expect(page.getByRole("dialog")).toContainText("Trần Thị Hương");
  await expect(page.getByRole("dialog")).toContainText("Tạo lượt đặt cho bàn này");
  await page.keyboard.press("Escape");

  // danh sách & lịch theo giờ
  await page.getByRole("tab", { name: "Danh sách đặt bàn" }).click();
  await expect(page.getByRole("row", { name: /Trần Thị Hương/ })).toBeVisible();
  await page.getByRole("tab", { name: "Lịch theo giờ" }).click();
  await expect(page.getByRole("link", { name: /18:00 Trần Thị Hương/ }).first()).toBeVisible();
});
