import { Pool, type PoolClient } from "pg";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const DB = process.env.TEST_DB ?? "khoai_test";
export const pool = new Pool({
  host: "127.0.0.1", user: "khoai_test", password: "test", database: DB, max: 12,
});

export function resetDb() {
  execFileSync(path.join(__dirname, "setup.sh"), [DB], { stdio: "pipe" });
}

export type Who = { id: string } | null;

/** Chạy một câu lệnh với vai trò & JWT giống PostgREST: role authenticated/anon + claims. */
export async function asUser<T>(who: Who, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${who ? "authenticated" : "anon"}`);
    if (who) await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.id, role: "authenticated" })]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Gọi RPC như PostgREST: một giao dịch, trả về kết quả hoặc lỗi {message, detail}. */
export async function rpc(who: Who, fn: string, args: unknown[] = []) {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  try {
    const r = await asUser(who, (c) => c.query(`select public.${fn}(${ph}) as r`, args.map(a => (a !== null && typeof a === "object" && !Array.isArray(a)) ? JSON.stringify(a) : a)));
    return { data: r.rows[0].r, error: null as null | { message: string; detail?: string } };
  } catch (e: any) {
    return { data: null, error: { message: e.message as string, detail: e.detail as string | undefined, code: e.code as string } };
  }
}

export async function sql<T = any>(q: string, args: unknown[] = []) {
  const r = await pool.query(q, args);
  return r.rows as T[];
}

export async function addUser(email: string, name: string, role: "manager" | "receptionist", active = true) {
  const [u] = await sql<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  await sql("insert into public.profiles (id, full_name, email, role, active) values ($1,$2,$3,$4,$5)", [u.id, name, email, role, active]);
  return u;
}

export const tableId = async (code: string) => (await sql<{ id: string }>("select id from public.dining_tables where code=$1", [code]))[0].id;

/** Ngày giờ theo múi giờ Việt Nam, ví dụ vn("2030-05-04","18:30") */
export const vn = (d: string, t: string) => `${d}T${t}:00+07:00`;

export function bookingData(over: Record<string, unknown> = {}) {
  return {
    customer_name: "Nguyễn Văn A", customer_phone: "0901234567",
    start_at: vn("2030-05-04", "18:00"), end_at: vn("2030-05-04", "20:00"),
    party_size: 4, ...over,
  };
}
export const uuid = () => crypto.randomUUID();
