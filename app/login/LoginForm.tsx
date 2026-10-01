"use client";
import { useActionState } from "react";
import { signInAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" defaultValue={state?.email ?? ""} key={state?.email ?? "e"} />
      </div>
      <div>
        <label className="label" htmlFor="password">Mật khẩu</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? "Đang đăng nhập…" : "Đăng nhập"}</button>
    </form>
  );
}
