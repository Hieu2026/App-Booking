import { defineConfig } from "@playwright/test";
import fs from "node:fs";
// @ts-expect-error mjs helper không có kiểu
import { sign } from "./tests/e2e/jwt.mjs";

const ANON = sign({ role: "anon", iss: "mini" });
const APP = "http://127.0.0.1:3100";
// Môi trường này có sẵn Chromium; máy khác sẽ dùng trình duyệt do `npx playwright install` tải về.
const PRE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.CHROMIUM_PATH ?? (fs.existsSync(PRE) ? PRE : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: APP,
    launchOptions: { executablePath, args: ["--no-sandbox"] },
    trace: "off",
  },
  webServer: [
    {
      command: "node tests/e2e/mini-supabase.mjs",
      url: "http://127.0.0.1:54321/auth/v1/logout",
      reuseExistingServer: !!process.env.E2E_REUSE,
      env: { E2E_DB: "khoai_e2e", SHIM_PORT: "54321" },
      timeout: 30_000,
    },
    {
      command: "npx next build && npx next start -p 3100 -H 127.0.0.1",
      url: `${APP}/login`,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 240_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
        SUPABASE_SERVICE_ROLE_KEY: sign({ role: "service_role", iss: "mini" }),
        NEXT_PUBLIC_POLL_SECONDS: "5",
      },
    },
  ],
});
