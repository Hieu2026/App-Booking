import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { pool, resetDb, sql } from "./helpers";
import { execFileSync } from "node:child_process";
import path from "node:path";

beforeAll(() => resetDb());
afterAll(() => pool.end());

describe("Danh mục bàn (seed)", () => {
  it("có đúng 29 bàn/khu và 229 chỗ", async () => {
    const [r] = await sql("select count(*)::int n, sum(capacity)::int cap from dining_tables");
    expect(r).toEqual({ n: 29, cap: 229 });
  });
  it("đúng tổng từng tầng: trệt 15/60, tầng 2 12/89, tầng 4 2/80", async () => {
    const rows = await sql("select floor_code, count(*)::int n, sum(capacity)::int cap from dining_tables group by 1 order by 1");
    expect(rows).toEqual([
      { floor_code: "T1", n: 15, cap: 60 }, { floor_code: "T2", n: 12, cap: 89 }, { floor_code: "T4", n: 2, cap: 80 },
    ]);
  });
  it("phân biệt B1.1 và B1.10, giữ STT/STN, bỏ khoảng trắng 'VIP 4'", async () => {
    const rows = await sql("select code, capacity from dining_tables where code in ('B1.1','B1.10','STT','STN','VIP 4') order by code");
    expect(rows).toEqual([
      { code: "B1.1", capacity: 15 }, { code: "B1.10", capacity: 15 }, { code: "STN", capacity: 50 },
      { code: "STT", capacity: 30 }, { code: "VIP 4", capacity: 5 },
    ]);
    expect(await sql("select 1 from dining_tables where code <> btrim(code)")).toHaveLength(0);
  });
  it("không có mã bàn trùng và bàn mã khác nhau về sức chứa đúng theo Excel", async () => {
    const m = Object.fromEntries((await sql("select code, capacity from dining_tables")).map((r: any) => [r.code, r.capacity]));
    expect(m).toMatchObject({ A3: 6, A5: 2, A8: 6, A10: 2, "VIP 1": 10, "VIP 7": 10, "B2.1": 6, "B2.4": 8, STT: 30, STN: 50 });
  });
  it("chạy seed lặp lại không tạo trùng và không ghi đè chỉnh sửa", async () => {
    await sql("update dining_tables set capacity = 7 where code = 'A1'");
    const f = path.join(__dirname, "../../supabase/seed.sql");
    for (let i = 0; i < 2; i++)
      execFileSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "khoai_test", "-d", process.env.TEST_DB ?? "khoai_test", "-f", f], { env: { ...process.env, PGPASSWORD: "test" } });
    const [r] = await sql("select count(*)::int n, (select capacity from dining_tables where code='A1') a1, (select count(*)::int from lookups) l from dining_tables");
    expect(r).toEqual({ n: 29, a1: 7, l: 15 });
    await sql("update dining_tables set capacity = 4 where code = 'A1'");
  });
  it("giờ mở cửa mặc định 10:00–22:00, đệm 0 phút", async () => {
    const [s] = await sql("select open_time::text o, close_time::text c, buffer_minutes b from app_settings");
    expect(s).toEqual({ o: "10:00:00", c: "22:00:00", b: 0 });
  });
});
