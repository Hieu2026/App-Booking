// Tạo tài khoản nhân viên (hoặc quản lý đầu tiên) bằng khóa service_role — chạy trên máy của quản trị viên.
// Cách dùng:  npm run create-user -- --email a@b.com --name "Nguyễn Văn A" --role manager
// Mật khẩu được hỏi khi chạy (không hiện trên màn hình, không lưu vào lịch sử lệnh).
import { createClient } from "@supabase/supabase-js";
import readline from "node:readline";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const { email, name, role = "receptionist" } = args;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (đặt trong .env.local)."); process.exit(1); }
if (!email || !name || !["manager", "receptionist"].includes(role)) {
  console.error('Dùng: npm run create-user -- --email a@b.com --name "Họ tên" --role manager|receptionist'); process.exit(1);
}

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput;
    rl._writeToOutput = (s) => { if (s.includes(q)) write.call(rl, s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

const password = process.env.NEW_USER_PASSWORD ?? (await askHidden("Mật khẩu (tối thiểu 10 ký tự): "));
if (password.length < 10) { console.error("Mật khẩu phải có ít nhất 10 ký tự."); process.exit(1); }

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.auth.admin.createUser({ email: email.toLowerCase(), password, email_confirm: true });
if (error) { console.error("Không tạo được tài khoản:", error.message); process.exit(1); }
const { error: pe } = await admin.from("profiles").insert({ id: data.user.id, full_name: name, email: email.toLowerCase(), role, active: true });
if (pe) { await admin.auth.admin.deleteUser(data.user.id); console.error("Không tạo được hồ sơ nhân viên:", pe.message); process.exit(1); }
console.log(`Đã tạo ${role === "manager" ? "quản lý" : "nhân viên"} ${name} <${email}>.`);
