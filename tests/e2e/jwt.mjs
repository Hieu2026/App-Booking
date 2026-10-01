import crypto from "node:crypto";
// Dùng chung cho công cụ kiểm thử cục bộ.
export const SECRET = "test-secret-test-secret-test-secret-123456";

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export const sign = (payload) => {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload);
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
export const verify = (t) => {
  const [h, p, s] = (t ?? "").split(".");
  if (!s) return null;
  const ok = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (ok !== s) return null;
  const pl = JSON.parse(Buffer.from(p, "base64url").toString());
  return pl.exp && pl.exp < Date.now() / 1000 ? null : pl;
};
export const hash = (pw) => { const salt = crypto.randomBytes(8).toString("hex"); return `${salt}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`; };
export const check = (pw, h) => { const [salt, k] = (h ?? ":").split(":"); return crypto.scryptSync(pw, salt, 32).toString("hex") === k; };

