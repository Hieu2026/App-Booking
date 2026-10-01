"use server";
import { rpc } from "@/lib/data";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { describeError, type AppError } from "@/lib/errors";
import type { Booking } from "@/lib/types";

export type ActionResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: AppError; message: string; latest?: Booking | null };

async function run<T = any>(name: string, args: Record<string, unknown>, bookingId?: string): Promise<ActionResult<T>> {
  const r = await rpc<T>(name, args);
  if (r.error) {
    let latest: Booking | null | undefined;
    if (bookingId && (r.error.code === "E_VERSION" || r.error.code === "E_TRANSITION" || r.error.code === "E_FINAL")) {
      latest = (await rpc<Booking>("get_booking", { p_id: bookingId })).data;
    }
    return { ok: false, error: r.error, message: describeError(r.error), latest };
  }
  return { ok: true, data: r.data as T };
}

export interface BookingInput {
  requestId: string;
  data: Record<string, unknown>;
  tables: string[];
  items: { name: string; qty: number; note?: string | null }[];
  overrideReason?: string | null;
}

export async function createBookingAction(i: BookingInput & { walkIn?: boolean }) {
  return run("create_booking", {
    p_request_id: i.requestId, p_data: i.data, p_tables: i.tables, p_items: i.items,
    p_override_reason: i.overrideReason || null, p_walk_in: !!i.walkIn,
  });
}

export async function updateBookingAction(i: BookingInput & { id: string; version: number }) {
  return run("update_booking", {
    p_request_id: i.requestId, p_id: i.id, p_expected_version: i.version, p_data: i.data,
    p_tables: i.tables, p_items: i.items, p_override_reason: i.overrideReason || null,
  }, i.id);
}

export async function moveTableAction(i: { requestId: string; id: string; version: number; from: string; to: string; overrideReason?: string | null }) {
  return run("move_booking_table", {
    p_request_id: i.requestId, p_id: i.id, p_expected_version: i.version, p_from: i.from, p_to: i.to,
    p_override_reason: i.overrideReason || null,
  }, i.id);
}

export async function setStatusAction(i: { requestId: string; id: string; version: number; action: string; reason?: string }) {
  return run("set_booking_status", {
    p_request_id: i.requestId, p_id: i.id, p_expected_version: i.version, p_action: i.action, p_reason: i.reason ?? null,
  }, i.id);
}

export async function setTableStatusAction(i: { tableId: string; status: "ready" | "suspended"; note?: string }) {
  return run("set_table_status", { p_table_id: i.tableId, p_status: i.status, p_note: i.note ?? null });
}

export async function getBookingAction(id: string) {
  return run<Booking>("get_booking", { p_id: id });
}

export async function getHistoryAction(id: string) {
  return run<any[]>("get_booking_history", { p_id: id });
}

// ------------------------------------------------------------------ quản lý
export async function saveTableAction(i: { id: string | null; code: string; floor: string; capacity: number; active: boolean; note: string }) {
  return run("admin_save_table", { p_id: i.id, p_code: i.code, p_floor_code: i.floor, p_capacity: i.capacity, p_active: i.active, p_note: i.note || null });
}
export async function saveLookupAction(i: { id: string | null; kind: string; label: string; active: boolean; sort: number }) {
  return run("admin_save_lookup", { p_id: i.id, p_kind: i.kind, p_label: i.label, p_active: i.active, p_sort_order: i.sort });
}
export async function saveSettingsAction(i: { open: string; close: string; buffer: number; duration: number }) {
  return run("admin_save_settings", { p_open: i.open, p_close: i.close, p_buffer_minutes: i.buffer, p_default_duration: i.duration });
}
export async function setProfileAction(i: { id: string; name: string; role: "manager" | "receptionist"; active: boolean }) {
  return run("admin_set_profile", { p_id: i.id, p_full_name: i.name, p_role: i.role, p_active: i.active });
}

async function assertManager(): Promise<AppError | null> {
  const r = await rpc<any[]>("get_profiles"); // chỉ quản lý gọi được
  return r.error;
}

export async function createStaffAction(i: { email: string; name: string; role: "manager" | "receptionist"; password: string }): Promise<ActionResult> {
  const denied = await assertManager();
  if (denied) return { ok: false, error: denied, message: describeError(denied) };
  const email = i.email.trim().toLowerCase();
  const name = i.name.trim();
  const bad = (m: string): ActionResult => ({ ok: false, error: { code: "E_VALIDATION", message: m, detail: { message: m } }, message: m });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Email không hợp lệ.");
  if (!name) return bad("Nhập họ tên.");
  if (i.password.length < 10) return bad("Mật khẩu tạm phải có ít nhất 10 ký tự.");
  try {
    const admin = createServiceClient();
    const { data, error } = await admin.auth.admin.createUser({ email, password: i.password, email_confirm: true });
    if (error || !data.user) return bad(/already|exists|registered/i.test(error?.message ?? "") ? "Email này đã có tài khoản." : "Không tạo được tài khoản. Kiểm tra lại thông tin.");
    const { error: pe } = await admin.from("profiles").insert({ id: data.user.id, full_name: name, email, role: i.role, active: true });
    if (pe) {
      await admin.auth.admin.deleteUser(data.user.id);
      return bad("Không tạo được hồ sơ nhân viên. Thử lại.");
    }
    const me = await rpc<any>("get_context");
    await admin.from("audit_log").insert({
      actor_id: me.data?.me.id, actor_name: me.data?.me.full_name, entity: "profile", entity_id: data.user.id,
      action: "profile_create", summary: `Tạo tài khoản ${name} (${email})`, changes: { role: i.role },
    });
    return { ok: true, data: { id: data.user.id } };
  } catch {
    const e: AppError = { code: "E_NETWORK", message: "network" };
    return { ok: false, error: e, message: describeError(e) };
  }
}

export async function resetPasswordAction(i: { id: string; password: string }): Promise<ActionResult> {
  const denied = await assertManager();
  if (denied) return { ok: false, error: denied, message: describeError(denied) };
  if (i.password.length < 10) {
    const m = "Mật khẩu tạm phải có ít nhất 10 ký tự.";
    return { ok: false, error: { code: "E_VALIDATION", message: m, detail: { message: m } }, message: m };
  }
  try {
    const { error } = await createServiceClient().auth.admin.updateUserById(i.id, { password: i.password });
    if (error) throw error;
    const me = await rpc<any>("get_context");
    await createServiceClient().from("audit_log").insert({
      actor_id: me.data?.me.id, actor_name: me.data?.me.full_name, entity: "profile", entity_id: i.id,
      action: "profile_update", summary: "Đặt lại mật khẩu tài khoản",
    });
    return { ok: true, data: null };
  } catch {
    const e: AppError = { code: "E_UNKNOWN", message: "reset" };
    return { ok: false, error: e, message: "Không đặt lại được mật khẩu. Thử lại." };
  }
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
