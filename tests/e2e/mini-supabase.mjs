// CÔNG CỤ KIỂM THỬ CỤC BỘ — KHÔNG TRIỂN KHAI.
// Mô phỏng phần nhỏ của Supabase (đăng nhập + gọi RPC) trên PostgreSQL thật để chạy trình duyệt tự động.
// Mọi truy vấn chạy bằng vai trò authenticated/anon của PostgreSQL → RLS và quyền hàm là thật.
// Không có Realtime (ứng dụng tự chuyển sang làm mới định kỳ).
import http from "node:http";
import { sign, verify, hash, check } from "./jwt.mjs";
import pg from "pg";

const DB = process.env.E2E_DB ?? "khoai_e2e";
const PORT = Number(process.env.SHIM_PORT ?? 54321);
const pool = new pg.Pool({ host: "127.0.0.1", user: "khoai_test", password: "test", database: DB, max: 20 });
pool.on('error', () => {});
export const ANON = sign({ role: "anon", iss: "mini" });
export const SERVICE = sign({ role: "service_role", iss: "mini" });
console.log(JSON.stringify({ ANON, SERVICE }));

const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const session = (u) => {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, iat: now, exp: now + 3600 });
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: sign({ sub: u.id, typ: "refresh", exp: now + 86400 * 7 }), user: userJson(u) };
};

const send = (res, code, body, extra = {}) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", ...extra });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : {})); });

const sigCache = new Map();
async function signature(name) {
  if (sigCache.has(name)) return sigCache.get(name);
  const r = await pool.query(
    `select p.proargnames names, array(select format_type(t, null) from unnest(p.proargtypes) t) types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname=$1`, [name]);
  sigCache.set(name, r.rows);
  return r.rows;
}
const pgArray = (a) => "{" + a.map((x) => (x === null ? "NULL" : `"${String(x).replace(/(["\\])/g, "\\$1")}"`)).join(",") + "}";

async function withRole(role, claims, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    if (claims) await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, undefined, { "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
  const url = new URL(req.url, "http://x");
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
  const claims = verify(bearer);
  try {
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const body = await readBody(req);
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const { rows } = await pool.query("select * from auth.users where lower(email)=lower($1)", [body.email]);
        if (!rows[0] || !check(body.password ?? "", rows[0].encrypted_password)) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        return send(res, 200, session(rows[0]));
      }
      if (grant === "refresh_token") {
        const rt = verify(body.refresh_token);
        if (!rt) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "bad refresh" });
        const { rows } = await pool.query("select * from auth.users where id=$1", [rt.sub]);
        return send(res, 200, session(rows[0]));
      }
    }
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      if (!claims?.sub) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      const { rows } = await pool.query("select * from auth.users where id=$1", [claims.sub]);
      if (!rows[0]) return send(res, 403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
      return send(res, 200, userJson(rows[0]));
    }
    if (url.pathname === "/auth/v1/logout") return send(res, 204);
    // ---- quản trị (service role)
    if (url.pathname.startsWith("/auth/v1/admin/users")) {
      if (claims?.role !== "service_role") return send(res, 403, { msg: "not admin" });
      const id = url.pathname.split("/")[5];
      if (req.method === "POST") {
        const b = await readBody(req);
        const ex = await pool.query("select 1 from auth.users where lower(email)=lower($1)", [b.email]);
        if (ex.rowCount) return send(res, 422, { code: 422, error_code: "email_exists", msg: "already registered" });
        const { rows } = await pool.query("insert into auth.users (email, encrypted_password) values ($1,$2) returning *", [b.email, hash(b.password)]);
        return send(res, 200, userJson(rows[0]));
      }
      if (req.method === "PUT") { const b = await readBody(req); await pool.query("update auth.users set encrypted_password=$2 where id=$1", [id, hash(b.password)]); return send(res, 200, { id }); }
      if (req.method === "DELETE") { await pool.query("delete from auth.users where id=$1", [id]); return send(res, 200, {}); }
    }
    // ---- REST
    if (url.pathname.startsWith("/rest/v1/")) {
      const role = claims?.role === "service_role" ? "service_role" : claims?.sub ? "authenticated" : "anon";
      if (!claims) return send(res, 401, { code: "PGRST301", message: "JWT invalid", details: null, hint: null });
      const name = url.pathname.slice("/rest/v1/".length);
      if (name.startsWith("rpc/") && req.method === "POST") {
        const fn = name.slice(4);
        const args = await readBody(req);
        const sigs = await signature(fn);
        if (!sigs.length) return send(res, 404, { code: "PGRST202", message: `function ${fn} not found`, details: null, hint: null });
        const keys = Object.keys(args);
        const sig = sigs.find((s) => keys.every((k) => (s.names ?? []).includes(k))) ?? sigs[0];
        const named = []; const vals = [];
        keys.forEach((k) => {
          const t = sig.types[(sig.names ?? []).indexOf(k)] ?? "text";
          let v = args[k];
          if (v !== null && t.endsWith("[]")) v = pgArray(v);
          else if (v !== null && (t === "jsonb" || t === "json")) v = JSON.stringify(v);
          vals.push(v); named.push(`${k} => $${vals.length}`);
        });
        const r = await withRole(role, role === "anon" ? null : claims, (c) => c.query(`select public.${fn}(${named.join(", ")}) as r`, vals));
        return send(res, 200, r.rows[0].r);
      }
      if (req.method === "POST" && role === "service_role") { // chèn đơn giản
        const body = await readBody(req);
        const rows = Array.isArray(body) ? body : [body];
        for (const row of rows) {
          const cols = Object.keys(row);
          await pool.query(`insert into public.${name.replace(/[^a-z_]/g, "")} (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, cols.map((c) => (typeof row[c] === "object" && row[c] !== null ? JSON.stringify(row[c]) : row[c])));
        }
        return send(res, 201, undefined);
      }
    }
    send(res, 404, { message: "not found" });
  } catch (e) {
    const denied = e.code === "42501";
    send(res, denied ? (claims?.sub ? 403 : 401) : 400, { code: e.code, message: e.message, details: e.detail ?? null, hint: null });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`mini-supabase http://127.0.0.1:${PORT} db=${DB}`));
