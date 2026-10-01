import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
// @ts-expect-error mjs helper không có kiểu
import { hash } from "./jwt.mjs";

export const PW = "MatKhau-Thu-1";
export const USERS = {
  manager: "quanly@khoai.test", le1: "letan1@khoai.test", le2: "letan2@khoai.test",
  le3: "letan3@khoai.test", le4: "letan4@khoai.test", locked: "khoa@khoai.test", stranger: "laixe@khoai.test",
};

export default async function globalSetup() {
  execFileSync(path.join(__dirname, "../db/setup.sh"), ["khoai_e2e"], { stdio: "pipe" });
  const pool = new pg.Pool({ host: "127.0.0.1", user: "khoai_test", password: "test", database: "khoai_e2e" });
  const add = async (email: string, name: string, role: string, active = true, profile = true) => {
    const { rows } = await pool.query("insert into auth.users (email, encrypted_password) values ($1,$2) returning id", [email, hash(PW)]);
    if (profile) await pool.query("insert into profiles (id, full_name, email, role, active) values ($1,$2,$3,$4,$5)", [rows[0].id, name, email, role, active]);
    return rows[0].id as string;
  };
  const mgr = await add(USERS.manager, "Quản Lý Hoa", "manager");
  await add(USERS.le1, "Lễ Tân Mai", "receptionist");
  await add(USERS.le2, "Lễ Tân Lan", "receptionist");
  await add(USERS.le3, "Sales Hùng", "receptionist");
  await add(USERS.le4, "Sales Dũng", "receptionist");
  await add(USERS.locked, "Đã Nghỉ Việc", "receptionist", false);
  await add(USERS.stranger, "Không Có Hồ Sơ", "receptionist", true, false);

  // Cấu hình để kiểm thử thao tác "bây giờ" ở mọi giờ trong ngày
  await pool.query("update app_settings set open_time='00:00', close_time='23:59'");

  // Dữ liệu mẫu: lượt đặt nhiều bàn, nhiều món, có cọc, số điện thoại bắt đầu bằng 0
  const c = await pool.connect();
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: mgr })]);
  const ids = (await pool.query("select id, code from dining_tables where code in ('B1.1','B1.10','VIP 1')")).rows;
  const id = (code: string) => ids.find((r) => r.code === code).id;
  await c.query("select public.create_booking($1, $2::jsonb, $3::uuid[], $4::jsonb)", [
    crypto.randomUUID(),
    JSON.stringify({ customer_name: "Trần Thị Hương", customer_phone: "0987654321", event_name: "Tiệc thôi nôi Bống", start_at: "2041-05-01T18:00:00+07:00", end_at: "2041-05-01T21:00:00+07:00", booked_at: "2041-04-20T09:30:00+07:00", party_size: 28, children_count: 6, deposit_amount: 3000000, contract_code: "=HD-001", special_requests: "=CMD|' /C calc'!A0" }),
    `{${id("B1.1")},${id("B1.10")}}`,
    JSON.stringify([{ name: "Gà quay", qty: 3 }, { name: "Lẩu hải sản", qty: 2, note: "ít cay" }, { name: "Chè", qty: 28 }]),
  ]);
  await c.query("commit");
  c.release();
  await pool.end();
}
