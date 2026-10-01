import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/** Client chạy với phiên đăng nhập của người dùng (RLS áp dụng). */
export async function createClient() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* gọi từ Server Component: proxy đã làm mới phiên */
        }
      },
    },
  });
}

/** Client quản trị (service role) — CHỈ dùng ở máy chủ, sau khi đã kiểm tra vai trò quản lý. */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Thiếu biến môi trường SUPABASE_SERVICE_ROLE_KEY");
  return createAdminClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
