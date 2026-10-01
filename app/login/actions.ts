"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signInAction(_prev: { error?: string; email?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Nhập email và mật khẩu.", email };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (/fetch|network/i.test(error.message)) return { error: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.", email };
      return { error: "Email hoặc mật khẩu không đúng.", email };
    }
  } catch {
    return { error: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.", email };
  }
  redirect("/");
}
