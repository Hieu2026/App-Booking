import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { addUser, asUser, bookingData, pool, resetDb, rpc, sql, tableId, uuid, vn } from "./helpers";

let mgr: { id: string }, rec1: { id: string }, rec2: { id: string }, rec3: { id: string }, rec4: { id: string };
let outsider: { id: string }, inactive: { id: string };

beforeAll(async () => {
  resetDb();
  mgr = await addUser("quanly@khoai.test", "Quản Lý", "manager");
  rec1 = await addUser("le1@khoai.test", "Lễ Tân 1", "receptionist");
  rec2 = await addUser("le2@khoai.test", "Lễ Tân 2", "receptionist");
  rec3 = await addUser("le3@khoai.test", "Sales 3", "receptionist");
  rec4 = await addUser("le4@khoai.test", "Sales 4", "receptionist");
  inactive = await addUser("nghi@khoai.test", "Đã Nghỉ", "receptionist", false);
  const [o] = await sql<{ id: string }>("insert into auth.users (email) values ('la@khoai.test') returning id");
  outsider = o; // có tài khoản đăng nhập nhưng KHÔNG có hồ sơ nhân viên
});
afterAll(() => pool.end());

const create = (who: any, tables: string[], over: Record<string, unknown> = {}, extra: any[] = []) =>
  Promise.all(tables.map(tableId)).then((ids) =>
    rpc(who, "create_booking", [uuid(), bookingData(over), ids, JSON.stringify([]), ...extra]));

describe("Tạo / sửa / hủy / hoàn tất", () => {
  it("tạo lượt đặt, mã duy nhất, thời gian lưu đúng, số điện thoại giữ số 0", async () => {
    const r = await create(rec1, ["A1"], { customer_phone: "0901 234 567", decoration: "Bóng bay", deposit_amount: 500000 });
    expect(r.error).toBeNull();
    expect(r.data.code).toMatch(/^KH-\d{5}$/);
    const [b] = await sql("select customer_phone, deposit_amount::text d, start_at, created_by, version from bookings where id=$1", [r.data.id]);
    expect(b.customer_phone).toBe("0901234567");
    expect(b.d).toBe("500000");
    expect(b.start_at.toISOString()).toBe("2030-05-04T11:00:00.000Z"); // 18:00 +07
    expect(b.created_by).toBe(rec1.id);
    expect(b.version).toBe(1);
  });

  it("lượt đặt trước bắt buộc tên, số điện thoại, bàn; khách vãng lai thì không", async () => {
    expect((await create(rec1, ["A2"], { customer_name: "" })).error?.message).toBe("E_VALIDATION");
    expect((await create(rec1, ["A2"], { customer_phone: null })).error?.message).toBe("E_VALIDATION");
    expect((await create(rec1, [], {})).error?.message).toBe("E_VALIDATION");
    expect((await create(rec1, ["A2"], { customer_phone: "abc" })).error?.message).toBe("E_VALIDATION");
    expect((await create(rec1, ["A2"], { party_size: 2, children_count: 3 })).error?.message).toBe("E_VALIDATION");
    expect((await create(rec1, ["A2"], { end_at: vn("2030-05-04", "17:00") })).error?.message).toBe("E_VALIDATION");
    expect((await create(rec1, ["A2"], { deposit_amount: -1 })).error?.message).toBe("E_VALIDATION");
    const ids = [await tableId("A5")];
    const w = await rpc(rec1, "create_booking", [uuid(), { start_at: vn("2030-06-01", "12:00"), end_at: vn("2030-06-01", "13:00"), party_size: 2 }, ids, "[]", null, true]);
    expect(w.error).toBeNull();
    expect(w.data.status).toBe("arrived");
  });

  it("sửa, xác nhận, hủy (cần lý do), hoàn tất → bàn chờ dọn → sẵn sàng", async () => {
    const c = await create(rec1, ["A3"], { start_at: vn("2030-07-01", "12:00"), end_at: vn("2030-07-01", "14:00"), party_size: 5 });
    let v = c.data.version;
    const u = await rpc(rec2, "update_booking", [uuid(), c.data.id, v, { event_name: "Sinh nhật bé Na", special_requests: "Không hành" }]);
    expect(u.error).toBeNull(); v = u.data.version; expect(v).toBe(2);
    const cf = await rpc(rec2, "set_booking_status", [uuid(), c.data.id, v, "confirm"]);
    expect(cf.data.status).toBe("confirmed"); v = cf.data.version;
    const ci = await rpc(rec2, "set_booking_status", [uuid(), c.data.id, v, "check_in"]);
    expect(ci.data.status).toBe("arrived"); v = ci.data.version;
    expect((await sql("select ops_status from dining_tables where code='A3'"))[0].ops_status).toBe("serving");
    // không hủy được khi đã đến
    expect((await rpc(rec2, "set_booking_status", [uuid(), c.data.id, v, "cancel", "x"])).error?.message).toBe("E_TRANSITION");
    const done = await rpc(rec2, "set_booking_status", [uuid(), c.data.id, v, "complete"]);
    expect(done.data.status).toBe("completed");
    expect((await sql("select ops_status from dining_tables where code='A3'"))[0].ops_status).toBe("cleaning");
    const A3 = await tableId("A3");
    expect((await rpc(rec2, "set_table_status", [A3, "ready"])).data.ops_status).toBe("ready");
    // đã hoàn tất thì không sửa nữa
    expect((await rpc(rec2, "update_booking", [uuid(), c.data.id, done.data.version, { event_name: "x" }])).error?.message).toBe("E_FINAL");
    // nhật ký ghi người thao tác
    const h = await rpc(rec1, "get_booking_history", [c.data.id]);
    expect(h.data.map((x: any) => x.action)).toEqual(["complete", "check_in", "confirm", "update", "create"]);
    expect(h.data[3].actor_name).toBe("Lễ Tân 2");
    expect(h.data[3].changes.diff["Tên tiệc / bàn"].to).toBe("Sinh nhật bé Na");
  });

  it("hủy bắt buộc lý do, và giải phóng bàn cho người khác đặt", async () => {
    const c = await create(rec1, ["A4"], { start_at: vn("2030-08-01", "12:00"), end_at: vn("2030-08-01", "14:00") });
    expect((await rpc(rec1, "set_booking_status", [uuid(), c.data.id, 1, "cancel", "  "])).error?.message).toBe("E_VALIDATION");
    expect((await create(rec2, ["A4"], { start_at: vn("2030-08-01", "13:00"), end_at: vn("2030-08-01", "15:00") })).error?.message).toBe("E_OVERLAP");
    const x = await rpc(rec1, "set_booking_status", [uuid(), c.data.id, 1, "cancel", "Khách báo bận"]);
    expect(x.data.status).toBe("cancelled");
    expect((await create(rec2, ["A4"], { start_at: vn("2030-08-01", "13:00"), end_at: vn("2030-08-01", "15:00") })).error).toBeNull();
  });
});

describe("Chống trùng lịch", () => {
  const day = "2031-01-10";
  it("khoảng [bắt đầu, kết thúc): liền kề thì được, giao nhau thì bị chặn kèm thông tin lượt đang giữ", async () => {
    const a = await create(rec1, ["A6"], { start_at: vn(day, "12:00"), end_at: vn(day, "14:00") });
    expect(a.error).toBeNull();
    expect((await create(rec2, ["A6"], { start_at: vn(day, "14:00"), end_at: vn(day, "16:00") })).error).toBeNull();
    expect((await create(rec2, ["A6"], { start_at: vn(day, "10:00"), end_at: vn(day, "12:00") })).error).toBeNull();
    const bad = await create(rec2, ["A6"], { start_at: vn(day, "13:59"), end_at: vn(day, "14:30") });
    expect(bad.error?.message).toBe("E_OVERLAP");
    const d = JSON.parse(bad.error!.detail!);
    expect(d.conflicts[0]).toMatchObject({ table: "A6", booking_code: a.data.code });
  });

  it("Chờ xác nhận / Đã xác nhận / Đã đến giữ chỗ; Không đến / Hoàn tất / Đã hủy không giữ chỗ", async () => {
    const d2 = "2031-02-01";
    const a = await create(rec1, ["A7"], { start_at: vn(d2, "12:00"), end_at: vn(d2, "14:00") });
    const clash = () => create(rec2, ["A7"], { start_at: vn(d2, "12:30"), end_at: vn(d2, "13:30") });
    expect((await clash()).error?.message).toBe("E_OVERLAP"); // chờ xác nhận
    const c = await rpc(rec1, "set_booking_status", [uuid(), a.data.id, 1, "confirm"]);
    expect((await clash()).error?.message).toBe("E_OVERLAP"); // đã xác nhận
    const n = await rpc(rec1, "set_booking_status", [uuid(), a.data.id, c.data.version, "no_show"]);
    expect(n.data.status).toBe("no_show");
    expect((await clash()).error).toBeNull(); // không đến → nhả bàn
  });

  it("đặt nhiều bàn: một bàn trùng thì KHÔNG bàn nào được ghi nhận", async () => {
    const d3 = "2031-03-01";
    await create(rec1, ["A9"], { start_at: vn(d3, "12:00"), end_at: vn(d3, "14:00") });
    const before = await sql("select (select count(*) from bookings)::int b, (select count(*) from booking_tables)::int t");
    const r = await create(rec2, ["A8", "A9", "A10"], { start_at: vn(d3, "13:00"), end_at: vn(d3, "15:00"), party_size: 6 });
    expect(r.error?.message).toBe("E_OVERLAP");
    expect(await sql("select (select count(*) from bookings)::int b, (select count(*) from booking_tables)::int t")).toEqual(before);
    expect(await sql("select 1 from booking_tables bt join dining_tables t on t.id=bt.table_id where t.code in ('A8','A10') and bt.during && tstzrange($1,$2)", [vn(d3, "13:00"), vn(d3, "15:00")])).toHaveLength(0);
    // còn bàn trống thì đặt nhiều bàn thành công, số bàn tính theo danh sách
    const ok = await create(rec2, ["A8", "A10"], { start_at: vn(d3, "13:00"), end_at: vn(d3, "15:00"), party_size: 6 });
    expect(ok.error).toBeNull();
    expect((await sql("select count(*)::int n from booking_tables where booking_id=$1", [ok.data.id]))[0].n).toBe(2);
  });

  it("đổi giờ / đổi bàn / thêm-bớt bàn được kiểm tra lại và nguyên tử", async () => {
    const d4 = "2031-04-01";
    const a = await create(rec1, ["A11"], { start_at: vn(d4, "12:00"), end_at: vn(d4, "14:00") });
    await create(rec1, ["A12"], { start_at: vn(d4, "15:00"), end_at: vn(d4, "17:00") });
    const [A11, A12, A13] = await Promise.all(["A11", "A12", "A13"].map(tableId));
    // đổi giờ sang khung trùng bàn cũ khác? A11 trống → OK
    let r = await rpc(rec1, "update_booking", [uuid(), a.data.id, 1, { start_at: vn(d4, "14:00"), end_at: vn(d4, "16:00") }]);
    expect(r.error).toBeNull();
    // thêm A12 vào khung 14–16 → trùng với lượt 15–17: lỗi, không đổi gì
    const before = await sql("select count(*)::int n from booking_tables where booking_id=$1", [a.data.id]);
    r = await rpc(rec1, "update_booking", [uuid(), a.data.id, 2, {}, [A11, A12]]);
    expect(r.error?.message).toBe("E_OVERLAP");
    expect(await sql("select count(*)::int n from booking_tables where booking_id=$1", [a.data.id])).toEqual(before);
    expect((await sql("select version from bookings where id=$1", [a.data.id]))[0].version).toBe(2);
    // thêm A13 ok; chuyển A11 → A14
    r = await rpc(rec1, "update_booking", [uuid(), a.data.id, 2, {}, [A11, A13]]); expect(r.error).toBeNull();
    const A14 = await tableId("A14");
    r = await rpc(rec1, "move_booking_table", [uuid(), a.data.id, 3, A11, A14]); expect(r.error).toBeNull();
    const t = await sql("select t.code from booking_tables bt join dining_tables t on t.id=bt.table_id where booking_id=$1 order by 1", [a.data.id]);
    expect(t.map((x: any) => x.code)).toEqual(["A13", "A14"]);
    // đổi giờ có hiệu lực cho cả hai bàn: bàn cũ A11 đã được nhả
    expect((await create(rec2, ["A11"], { start_at: vn(d4, "14:00"), end_at: vn(d4, "16:00") })).error).toBeNull();
  });

  it("5 yêu cầu đồng thời đặt cùng bàn, cùng khung giờ: đúng 1 thành công, còn lại E_OVERLAP", async () => {
    for (let round = 0; round < 5; round++) {
      const d = `2032-0${round + 1}-15`;
      const users = [rec1, rec2, rec3, rec4, mgr];
      const res = await Promise.all(users.map((u) => create(u, ["B2.4"], { start_at: vn(d, "18:00"), end_at: vn(d, "20:00"), party_size: 6 })));
      expect(res.filter((r) => !r.error)).toHaveLength(1);
      expect(res.filter((r) => r.error?.message === "E_OVERLAP")).toHaveLength(4);
      expect((await sql("select count(*)::int n from booking_tables bt join dining_tables t on t.id=bt.table_id where t.code='B2.4' and lower(during)=$1", [vn(d, "18:00")]))[0].n).toBe(1);
    }
  });

  it("hai nhân viên đặt nhiều bàn chéo nhau (A, B) và (B, A) cùng lúc: không kẹt, không dữ liệu dở dang", async () => {
    const d = "2032-09-09";
    const mk = (u: any, t: string[]) => create(u, t, { start_at: vn(d, "18:00"), end_at: vn(d, "20:00"), party_size: 8 });
    const res = await Promise.all([mk(rec1, ["VIP 1", "VIP 7"]), mk(rec2, ["VIP 7", "VIP 1"]), mk(rec3, ["VIP 1"]), mk(rec4, ["VIP 7"])]);
    const ok = res.filter((r) => !r.error);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of res) if (r.error) expect(["E_OVERLAP"]).toContain(r.error.message);
    const rows = await sql("select b.id from bookings b join booking_tables bt on bt.booking_id=b.id join dining_tables t on t.id=bt.table_id where t.code in ('VIP 1','VIP 7') and lower(bt.during)=$1 group by b.id", [vn(d, "18:00")]);
    expect(rows.length).toBe(ok.length);
    // mỗi bàn đúng một lượt giữ chỗ
    const per = await sql("select t.code, count(*)::int n from booking_tables bt join dining_tables t on t.id=bt.table_id where t.code in ('VIP 1','VIP 7') and lower(bt.during)=$1 group by 1", [vn(d, "18:00")]);
    for (const p of per) expect(p.n).toBe(1);
  });
});

describe("Kiểm soát phiên bản & chống gửi lặp", () => {
  it("sửa từ dữ liệu cũ không âm thầm ghi đè", async () => {
    const c = await create(rec1, ["B2.1"], { start_at: vn("2033-01-05", "12:00"), end_at: vn("2033-01-05", "14:00") });
    const first = await rpc(rec1, "update_booking", [uuid(), c.data.id, 1, { event_name: "Bản của Lễ Tân 1" }]);
    expect(first.error).toBeNull();
    const stale = await rpc(rec2, "update_booking", [uuid(), c.data.id, 1, { event_name: "Bản cũ của Lễ Tân 2" }]);
    expect(stale.error?.message).toBe("E_VERSION");
    expect(JSON.parse(stale.error!.detail!)).toMatchObject({ current_version: 2, updated_by: "Lễ Tân 1" });
    expect((await sql("select event_name from bookings where id=$1", [c.data.id]))[0].event_name).toBe("Bản của Lễ Tân 1");
    // đổi trạng thái từ phiên bản cũ cũng bị chặn
    expect((await rpc(rec2, "set_booking_status", [uuid(), c.data.id, 1, "confirm"])).error?.message).toBe("E_VERSION");
  });

  it("gửi lại cùng một yêu cầu (bấm lưu nhiều lần) chỉ tạo một lượt đặt", async () => {
    const key = uuid();
    const t = [await tableId("B2.2")];
    const data = bookingData({ start_at: vn("2033-02-05", "12:00"), end_at: vn("2033-02-05", "14:00") });
    const res = await Promise.all([1, 2, 3, 4].map(() => rpc(rec1, "create_booking", [key, data, t, "[]"])));
    expect(res.every((r) => !r.error)).toBe(true);
    expect(new Set(res.map((r) => r.data.id)).size).toBe(1);
    expect((await sql("select count(*)::int n from bookings where start_at=$1", [vn("2033-02-05", "12:00")]))[0].n).toBe(1);
    // gửi lại sau khi đã xong cũng trả về kết quả cũ
    const again = await rpc(rec1, "create_booking", [key, data, t, "[]"]);
    expect(again.data.id).toBe(res[0].data.id);
    // sửa: bấm 2 lần cùng yêu cầu không báo xung đột phiên bản
    const k2 = uuid();
    const u1 = await rpc(rec1, "update_booking", [k2, res[0].data.id, 1, { event_name: "A" }]);
    const u2 = await rpc(rec1, "update_booking", [k2, res[0].data.id, 1, { event_name: "A" }]);
    expect(u1.error).toBeNull(); expect(u2.error).toBeNull(); expect(u2.data.version).toBe(2);
    // người khác không dùng lại được khóa của người này
    expect((await rpc(rec2, "update_booking", [k2, res[0].data.id, 2, { event_name: "B" }])).error?.message).toBe("E_VALIDATION");
  });
});

describe("Cảnh báo & ghi đè", () => {
  it("vượt sức chứa: lễ tân bị chặn; quản lý ghi đè cần lý do và được ghi nhật ký", async () => {
    const d = "2034-01-10";
    const over = { start_at: vn(d, "12:00"), end_at: vn(d, "14:00"), party_size: 9 };
    const r1 = await create(rec1, ["A1"], over, [null]);
    expect(r1.error?.message).toBe("E_WARNING");
    expect(JSON.parse(r1.error!.detail!)).toMatchObject({ can_override: false, warnings: [{ type: "capacity" }] });
    expect((await create(rec1, ["A1"], over, ["Khách xin kê thêm ghế"])).error?.message).toBe("E_WARNING"); // lễ tân không ghi đè được
    const r0 = await create(mgr, ["A1"], over, [null]);
    expect(JSON.parse(r0.error!.detail!).can_override).toBe(true);
    const r2 = await create(mgr, ["A1"], over, ["Khách xin kê thêm ghế"]);
    expect(r2.error).toBeNull();
    const [b] = await sql("select override_reason from bookings where id=$1", [r2.data.id]);
    expect(b.override_reason).toBe("Khách xin kê thêm ghế");
    const h = await rpc(mgr, "get_booking_history", [r2.data.id]);
    expect(h.data[0].changes.override_reason).toBe("Khách xin kê thêm ghế");
  });

  it("ngoài giờ mở cửa (trước 10:00, sau 22:00, qua nửa đêm) bị cảnh báo; 10:00–22:00 thì không", async () => {
    const d = "2034-02-10";
    expect((await create(rec1, ["A2"], { start_at: vn(d, "09:30"), end_at: vn(d, "11:00") })).error?.message).toBe("E_WARNING");
    expect((await create(rec1, ["A2"], { start_at: vn(d, "21:00"), end_at: vn(d, "22:30") })).error?.message).toBe("E_WARNING");
    expect((await create(rec1, ["A2"], { start_at: vn(d, "21:00"), end_at: vn("2034-02-11", "01:00") })).error?.message).toBe("E_WARNING");
    expect((await create(rec1, ["A2"], { start_at: vn(d, "10:00"), end_at: vn(d, "22:00") })).error).toBeNull();
    expect((await create(mgr, ["A5"], { start_at: vn(d, "22:00"), end_at: vn(d, "23:00"), party_size: 2 }, ["Tiệc muộn đã thống nhất"])).error).toBeNull();
  });

  it("sửa ghi chú của lượt đã ghi đè không bị cảnh báo lại; trùng lịch thì quản lý cũng KHÔNG ghi đè được", async () => {
    const d = "2034-03-10";
    const r = await create(mgr, ["A1"], { start_at: vn(d, "12:00"), end_at: vn(d, "14:00"), party_size: 9 }, ["lý do"]);
    expect((await rpc(rec1, "update_booking", [uuid(), r.data.id, 1, { special_requests: "Thêm ghế trẻ em" }])).error).toBeNull();
    const clash = await create(mgr, ["A1"], { start_at: vn(d, "13:00"), end_at: vn(d, "15:00"), party_size: 9 }, ["muốn ghi đè"]);
    expect(clash.error?.message).toBe("E_OVERLAP");
  });
});

describe("Vận hành bàn", () => {
  it("khách vãng lai vào bàn → Đang phục vụ; bàn đang phục vụ/chờ dọn/tạm ngưng không nhận khách mới", async () => {
    const d = "2035-01-01";
    const T = await tableId("A15");
    const w = await rpc(rec1, "create_booking", [uuid(), { start_at: vn(d, "12:00"), end_at: vn(d, "13:30"), party_size: 3 }, [T], "[]", null, true]);
    expect(w.error).toBeNull();
    // khách thứ hai muốn vào bàn đang phục vụ
    const w2 = await rpc(rec2, "create_booking", [uuid(), { start_at: vn(d, "14:00"), end_at: vn(d, "15:00"), party_size: 3 }, [T], "[]", null, true]);
    expect(w2.error?.message).toBe("E_TABLE_BUSY");
    // đặt trước cho sau đó: được
    const adv = await create(rec2, ["A15"], { start_at: vn(d, "14:00"), end_at: vn(d, "16:00") });
    expect(adv.error).toBeNull();
    // khách đầu chưa xong dù quá giờ: lượt kế tiếp không thể bắt đầu phục vụ
    const ci = await rpc(rec2, "set_booking_status", [uuid(), adv.data.id, 1, "check_in"]);
    expect(ci.error?.message).toBe("E_TABLE_BUSY");
    expect(JSON.parse(ci.error!.detail!)).toMatchObject({ table: "A15", serving_booking: w.data.code });
    // hoàn tất → chờ dọn → vẫn chưa nhận khách đến khi xác nhận sẵn sàng
    await rpc(rec1, "set_booking_status", [uuid(), w.data.id, 1, "complete"]);
    expect((await rpc(rec2, "set_booking_status", [uuid(), adv.data.id, 1, "check_in"])).error?.message).toBe("E_TABLE_BUSY");
    await rpc(rec1, "set_table_status", [T, "ready"]);
    expect((await rpc(rec2, "set_booking_status", [uuid(), adv.data.id, 1, "check_in"])).error).toBeNull();
  });

  it("tạm ngưng và mở lại bàn; bàn tạm ngưng không nhận lượt đặt mới; không tạm ngưng bàn đang phục vụ", async () => {
    const T = await tableId("A14");
    expect((await rpc(rec1, "set_table_status", [T, "suspended", "Hỏng điều hòa"])).data.ops_status).toBe("suspended");
    expect((await create(rec1, ["A14"], { start_at: vn("2035-02-01", "12:00"), end_at: vn("2035-02-01", "13:00") })).error?.message).toBe("E_TABLE_SUSPENDED");
    expect((await rpc(rec1, "set_table_status", [T, "ready"])).data.ops_status).toBe("ready");
    expect((await create(rec1, ["A14"], { start_at: vn("2035-02-01", "12:00"), end_at: vn("2035-02-01", "13:00") })).error).toBeNull();
    const w = await rpc(rec1, "create_booking", [uuid(), { start_at: vn("2035-03-01", "12:00"), end_at: vn("2035-03-01", "13:00"), party_size: 2 }, [await tableId("A13")], "[]", null, true]);
    expect(w.error).toBeNull();
    expect((await rpc(rec1, "set_table_status", [await tableId("A13"), "suspended"])).error?.message).toBe("E_TABLE_BUSY");
  });

  it("đổi bàn khi đang phục vụ: bàn cũ → chờ dọn, bàn mới → đang phục vụ", async () => {
    const [X, Y] = await Promise.all([tableId("B2.5"), tableId("B2.6")]);
    const w = await rpc(rec1, "create_booking", [uuid(), { start_at: vn("2035-04-01", "12:00"), end_at: vn("2035-04-01", "13:00"), party_size: 2 }, [X], "[]", null, true]);
    const m = await rpc(rec1, "move_booking_table", [uuid(), w.data.id, 1, X, Y]);
    expect(m.error).toBeNull();
    const st = await sql("select code, ops_status from dining_tables where code in ('B2.5','B2.6') order by code");
    expect(st).toEqual([{ code: "B2.5", ops_status: "cleaning" }, { code: "B2.6", ops_status: "serving" }]);
  });
});

describe("Phân quyền (RLS) trên cơ sở dữ liệu thật", () => {
  const fns: [string, unknown[]][] = [
    ["get_context", []], ["get_board", ["2030-05-04"]], ["search_bookings", [{}]],
    ["get_availability", [vn("2030-05-04", "12:00"), vn("2030-05-04", "14:00")]],
  ];
  it("chưa đăng nhập: không đọc/ghi được bất kỳ bảng hoặc hàm nào", async () => {
    for (const t of ["bookings", "booking_tables", "booking_items", "dining_tables", "profiles", "audit_log", "lookups", "app_settings", "idempotency_keys"]) {
      await expect(asUser(null, (c) => c.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(null, (c) => c.query("insert into public.bookings (start_at,end_at,party_size) values (now(), now()+'1h', 1)"))).rejects.toThrow(/permission denied/);
    for (const [f, a] of fns) expect((await rpc(null, f, a)).error?.message).toMatch(/permission denied/);
    expect((await rpc(null, "create_booking", [uuid(), bookingData(), [await tableId("A1")], "[]"])).error?.message).toMatch(/permission denied/);
  });

  it("có tài khoản nhưng không có hồ sơ nhân viên, hoặc đã bị khóa: không thấy gì, không ghi được", async () => {
    for (const who of [outsider, inactive]) {
      for (const t of ["bookings", "booking_tables", "dining_tables", "audit_log", "lookups"]) {
        expect((await asUser(who, (c) => c.query(`select * from public.${t}`))).rows).toHaveLength(0);
      }
      for (const [f, a] of fns) expect((await rpc(who, f, a)).error?.message).toBe("E_FORBIDDEN");
      expect((await create(who, ["A1"], { start_at: vn("2036-01-01", "12:00"), end_at: vn("2036-01-01", "13:00") })).error?.message).toBe("E_FORBIDDEN");
    }
    // tài khoản bị khóa chỉ đọc được hồ sơ của chính mình
    expect((await asUser(inactive, (c) => c.query("select * from public.profiles"))).rows).toHaveLength(1);
    expect((await asUser(outsider, (c) => c.query("select * from public.profiles"))).rows).toHaveLength(0);
  });

  it("nhân viên không ghi trực tiếp, không xóa cứng lượt đặt, không sửa/xóa nhật ký, không đọc khóa gửi lặp", async () => {
    const b = (await sql("select id from bookings limit 1"))[0].id;
    await expect(asUser(rec1, (c) => c.query("delete from public.bookings where id=$1", [b]))).rejects.toThrow(/permission denied/);
    await expect(asUser(rec1, (c) => c.query("update public.bookings set party_size=1 where id=$1", [b]))).rejects.toThrow(/permission denied/);
    await expect(asUser(rec1, (c) => c.query("update public.dining_tables set capacity=99"))).rejects.toThrow(/permission denied/);
    await expect(asUser(rec1, (c) => c.query("update public.profiles set role='manager' where id=$1", [rec1.id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(mgr, (c) => c.query("delete from public.audit_log"))).rejects.toThrow(/permission denied/);
    await expect(asUser(mgr, (c) => c.query("update public.audit_log set summary='x'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(rec1, (c) => c.query("select * from public.idempotency_keys"))).rejects.toThrow(/permission denied/);
    // ngay cả chủ sở hữu cũng không sửa được nhật ký
    await expect(sql("update audit_log set summary='x'")).rejects.toThrow(/Nhật ký không được sửa/);
    await expect(sql("delete from audit_log")).rejects.toThrow(/Nhật ký không được sửa/);
  });

  it("lễ tân không dùng được chức năng quản lý; quản lý dùng được", async () => {
    const T = await tableId("A1");
    expect((await rpc(rec1, "admin_save_table", [T, "A1", "T1", 99])).error?.message).toBe("E_FORBIDDEN");
    expect((await rpc(rec1, "admin_save_settings", ["10:00", "23:00", 0, 120])).error?.message).toBe("E_FORBIDDEN");
    expect((await rpc(rec1, "admin_save_lookup", [null, "source", "Tiktok", true, 9])).error?.message).toBe("E_FORBIDDEN");
    expect((await rpc(rec1, "admin_set_profile", [rec1.id, "X", "manager", true])).error?.message).toBe("E_FORBIDDEN");
    expect((await rpc(rec1, "get_audit_log", [{}])).error?.message).toBe("E_FORBIDDEN");
    expect((await rpc(rec1, "get_profiles", [])).error?.message).toBe("E_FORBIDDEN");
    expect((await rpc(mgr, "get_audit_log", [{}])).error).toBeNull();
    expect((await rpc(mgr, "admin_save_lookup", [null, "source", "Tiktok", true, 9])).error).toBeNull();
    expect((await rpc(mgr, "admin_save_table", [null, "  Z9 ", "T2", 6])).data.code).toBe("Z9");
    expect((await rpc(mgr, "admin_save_table", [null, "Z9", "T2", 6])).error?.message).toBe("E_VALIDATION");
    expect((await rpc(mgr, "admin_set_profile", [mgr.id, "Quản Lý", "receptionist", true])).error?.message).toBe("E_VALIDATION"); // không tự hạ quyền
    expect((await rpc(mgr, "admin_set_profile", [rec4.id, "Sales 4", "receptionist", false])).error).toBeNull();
    expect((await create(rec4, ["A1"], { start_at: vn("2036-01-01", "12:00"), end_at: vn("2036-01-01", "13:00") })).error?.message).toBe("E_FORBIDDEN"); // vừa bị khóa
    await rpc(mgr, "admin_set_profile", [rec4.id, "Sales 4", "receptionist", true]);
  });

  it("nhật ký: lễ tân chỉ xem lịch sử lượt đặt, không xem nhật ký thao tác bàn/cấu hình", async () => {
    const rows = (await asUser(rec1, (c) => c.query("select distinct entity from public.audit_log"))).rows.map((r) => r.entity);
    expect(rows).toEqual(["booking"]);
    const m = (await asUser(mgr, (c) => c.query("select distinct entity from public.audit_log order by 1"))).rows.map((r) => r.entity);
    expect(m).toEqual(expect.arrayContaining(["booking", "table", "lookup", "profile"]));
  });
});

describe("Tìm kiếm & báo cáo", () => {
  it("tìm theo tên không dấu, số điện thoại (kể cả khác định dạng), mã đặt chỗ, tên tiệc, mã bàn, Mã HĐ", async () => {
    const d = "2037-01-05";
    const r = await create(rec1, ["B1.10", "B1.1"], {
      customer_name: "Trần Thị Hương", customer_phone: "0987 654 321", event_name: "Tiệc thôi nôi Bống",
      contract_code: "HD-2037/01", start_at: vn(d, "18:00"), end_at: vn(d, "21:00"), party_size: 20,
      deposit_amount: 3000000,
    });
    expect(r.error).toBeNull();
    await rpc(rec1, "update_booking", [uuid(), r.data.id, 1, { deposit_amount: 3000000 }, null, JSON.stringify([{ name: "Gà", qty: 3 }, { name: "Lẩu", qty: 2, note: "ít cay" }])]);
    const find = async (q: string) => (await rpc(rec2, "search_bookings", [{ q }])).data;
    for (const q of ["huong", "Hương", "0987654321", "098 7654", "thôi nôi", "thoi noi", r.data.code.toLowerCase(), "B1.10", "HD-2037"]) {
      const f = await find(q);
      expect(f.rows.map((x: any) => x.id), q).toContain(r.data.id);
    }
    expect((await find("không có ai tên này")).total).toBe(0);
    const row = (await find("huong")).rows[0];
    expect(row.customer_phone).toBe("0987654321");
    expect(row.tables.map((t: any) => t.code)).toEqual(["B1.1", "B1.10"]);
    expect(row.items).toHaveLength(2);
  });

  it("tổng lượt đặt, tổng khách, tiền cọc tính ở cấp lượt đặt (không nhân theo số bàn/món)", async () => {
    const d = "2038-01-05";
    const r = await create(rec1, ["A1", "A2", "A3", "A4"], {
      start_at: vn(d, "18:00"), end_at: vn(d, "20:00"), party_size: 14, deposit_amount: 1000000, customer_phone: "0123456789",
    });
    await rpc(rec1, "update_booking", [uuid(), r.data.id, 1, {}, null, JSON.stringify([{ name: "a", qty: 1 }, { name: "b", qty: 1 }, { name: "c", qty: 1 }])]);
    const res = (await rpc(rec1, "search_bookings", [{ date_from: d, date_to: d }])).data;
    expect(res.total).toBe(1);
    expect(res.total_guests).toBe(14);
    expect(Number(res.total_deposit)).toBe(1000000);
    expect(res.rows[0].customer_phone).toBe("0123456789"); // giữ số 0 đầu
  });

  it("lọc theo ngày diễn ra / ngày khách đặt, tầng, bàn, trạng thái, tình trạng cọc, sắp xếp", async () => {
    const A = "2039-05-";
    const mk = (n: number, over: any) => create(rec1, ["A1"], { start_at: vn(`${A}0${n}`, "12:00"), end_at: vn(`${A}0${n}`, "13:00"), booked_at: vn(`2039-04-1${n}`, "09:00"), party_size: n + 1, ...over });
    await mk(1, { deposit_amount: 100000, customer_name: "An" });
    await mk(2, { customer_name: "Bình" });
    await mk(3, { customer_name: "Chi", deposit_amount: 300000 });
    const s = async (f: any, sort = "start_at", dir = "asc") => (await rpc(rec1, "search_bookings", [f, sort, dir])).data;
    expect((await s({ date_from: `${A}01`, date_to: `${A}02` })).total).toBe(2);
    expect((await s({ date_basis: "booked", date_from: "2039-04-12", date_to: "2039-04-13" })).total).toBe(2);
    expect((await s({ date_from: `${A}01`, date_to: `${A}03`, deposit: "has" })).total).toBe(2);
    expect((await s({ date_from: `${A}01`, date_to: `${A}03`, deposit: "none" })).total).toBe(1);
    expect((await s({ date_from: `${A}01`, date_to: `${A}03`, floor: "T2" })).total).toBe(0);
    expect((await s({ date_from: `${A}01`, date_to: `${A}03`, status: ["confirmed"] })).total).toBe(0);
    expect((await s({ date_from: `${A}01`, date_to: `${A}03`, table_id: await tableId("A1") })).total).toBe(3);
    const sorted = await s({ date_from: `${A}01`, date_to: `${A}03` }, "customer_name", "desc");
    expect(sorted.rows.map((r: any) => r.customer_name)).toEqual(["Chi", "Bình", "An"]);
    const bySize = await s({ date_from: `${A}01`, date_to: `${A}03` }, "party_size", "desc");
    expect(bySize.rows.map((r: any) => r.party_size)).toEqual([4, 3, 2]);
    // trường không hỗ trợ sắp xếp rơi về mặc định, không lỗi và không chèn SQL
    expect((await s({ date_from: `${A}01`, date_to: `${A}03` }, "1; drop table bookings; --")).total).toBe(3);
    expect((await sql("select count(*)::int n from bookings"))[0].n).toBeGreaterThan(10);
  });

  it("bốn phiên đồng thời cùng thấy dữ liệu vừa lưu (làm mới/đăng nhập máy khác)", async () => {
    const r = await create(rec1, ["A6"], { start_at: vn("2040-01-01", "12:00"), end_at: vn("2040-01-01", "13:00"), customer_name: "Khách chung" });
    const views = await Promise.all([rec1, rec2, rec3, rec4].map((u) => rpc(u, "get_board", ["2040-01-01"])));
    for (const v of views) expect(v.data.bookings.map((b: any) => b.id)).toContain(r.data.id);
  });
});

describe("Giờ & tiền", () => {
  it("thời gian lưu dạng timestamptz, hiển thị Asia/Ho_Chi_Minh; tiền cọc là numeric", async () => {
    const [c] = await sql("select data_type from information_schema.columns where table_name='bookings' and column_name='start_at'");
    expect(c.data_type).toBe("timestamp with time zone");
    const [d] = await sql("select data_type, numeric_scale from information_schema.columns where table_name='bookings' and column_name='deposit_amount'");
    expect(d).toEqual({ data_type: "numeric", numeric_scale: 0 });
    const [p] = await sql("select data_type from information_schema.columns where table_name='bookings' and column_name='customer_phone'");
    expect(p.data_type).toBe("text");
  });
});

describe("Khoảng đệm dọn bàn (cấu hình)", () => {
  it("đệm 15 phút: lượt liền kề bị chặn, cách đủ 15 phút thì được; đổi lại 0 phút", async () => {
    const d = "2041-03-03";
    expect((await rpc(mgr, "admin_save_settings", ["10:00", "22:00", 15, 120])).error).toBeNull();
    expect((await create(rec1, ["A8"], { start_at: vn(d, "12:00"), end_at: vn(d, "14:00") })).error).toBeNull();
    expect((await create(rec2, ["A8"], { start_at: vn(d, "14:00"), end_at: vn(d, "15:00") })).error?.message).toBe("E_OVERLAP");
    expect((await create(rec2, ["A8"], { start_at: vn(d, "14:15"), end_at: vn(d, "15:00") })).error).toBeNull();
    expect((await rpc(rec1, "admin_save_settings", ["10:00", "22:00", 0, 120])).error?.message).toBe("E_FORBIDDEN");
    expect((await rpc(mgr, "admin_save_settings", ["22:00", "10:00", 0, 120])).error?.message).toBe("E_VALIDATION");
    expect((await rpc(mgr, "admin_save_settings", ["10:00", "22:00", 0, 120])).error).toBeNull();
  });
});

describe("Nhân viên tư vấn & nguồn khách (danh mục cấu hình được)", () => {
  const opt = async (kind: string, label: string) => (await sql("select id from lookups where kind=$1 and label=$2", [kind, label]))[0].id as string;

  it("danh mục mẫu có đủ: nguồn BNI/TikTok/Website; tư vấn Lễ tân, Khánh Hồng, Cát Tường, Uyên Hồ", async () => {
    const src = (await sql("select label from lookups where kind='source'")).map((r: any) => r.label);
    expect(src).toEqual(expect.arrayContaining(["BNI", "TikTok", "Website"]));
    const pur = (await sql("select label from lookups where kind='purpose'")).map((r: any) => r.label);
    expect(pur).toEqual(expect.arrayContaining(["Báo hỷ", "Thôi nôi", "Kỷ niệm", "Sinh nhật", "Tổng kết"]));
    expect(new Set(pur).size).toBe(pur.length);
    const con = (await sql("select label from lookups where kind='consultant' order by sort_order")).map((r: any) => r.label);
    expect(con).toEqual(["Lễ tân", "Khánh Hồng", "Cát Tường", "Uyên Hồ"]);
  });

  it("lưu / sửa / lọc / sắp xếp / lịch sử theo nhân viên tư vấn và nguồn khách", async () => {
    const [kh, ct, bni] = await Promise.all([opt("consultant", "Khánh Hồng"), opt("consultant", "Cát Tường"), opt("source", "BNI")]);
    const d = "2043-02-02";
    const a = await create(rec1, ["A1"], { start_at: vn(d, "12:00"), end_at: vn(d, "13:00"), consultant_option_id: kh, source_id: bni, customer_name: "Khách KH" });
    const b = await create(rec1, ["A2"], { start_at: vn(d, "12:00"), end_at: vn(d, "13:00"), consultant_option_id: ct, customer_name: "Khách CT" });
    expect(a.error).toBeNull();
    const got = (await rpc(rec2, "get_booking", [a.data.id])).data;
    expect(got).toMatchObject({ consultant_option_id: kh, consultant_name: "Khánh Hồng", source_label: "BNI" });
    const only = (await rpc(rec2, "search_bookings", [{ consultant_id: kh, date_from: d, date_to: d }])).data;
    expect(only.rows.map((r: any) => r.customer_name)).toEqual(["Khách KH"]);
    const sorted = (await rpc(rec2, "search_bookings", [{ date_from: d, date_to: d }, "consultant", "desc"])).data;
    expect(sorted.rows.map((r: any) => r.consultant_name)).toEqual(["Khánh Hồng", "Cát Tường"]);
    const up = await rpc(rec2, "update_booking", [uuid(), b.data.id, 1, { consultant_option_id: kh }]);
    expect(up.error).toBeNull();
    const h = (await rpc(rec2, "get_booking_history", [b.data.id])).data;
    expect(h[0].changes.diff["Nhân viên tư vấn"]).toEqual({ from: "Cát Tường", to: "Khánh Hồng" });
  });

  it("quản lý thêm / ẩn nhân viên tư vấn; lễ tân thì không", async () => {
    expect((await rpc(rec1, "admin_save_lookup", [null, "consultant", "Người Mới", true, 9])).error?.message).toBe("E_FORBIDDEN");
    const r = await rpc(mgr, "admin_save_lookup", [null, "consultant", "Người Mới", true, 9]);
    expect(r.error).toBeNull();
    expect((await rpc(mgr, "admin_save_lookup", [null, "consultant", "Người Mới", true, 9])).error?.message).toBe("E_VALIDATION");
    expect((await rpc(mgr, "admin_save_lookup", [r.data.id, "consultant", "Người Mới", false, 9])).error).toBeNull();
    expect((await rpc(mgr, "admin_save_lookup", [null, "khong_co", "X", true, 1])).error?.message).toBe("E_VALIDATION");
  });
});

describe("Nâng cấp từ cấu trúc cũ (0001–0004) lên 0005", () => {
  it("giữ nguyên dữ liệu cũ, tên tư vấn cũ vẫn hiển thị, chức năng mới dùng được", async () => {
    const { execFileSync } = await import("node:child_process");
    const path = await import("node:path");
    const env = { ...process.env, PGPASSWORD: "test" };
    const psql = (db: string, ...a: string[]) => execFileSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "khoai_test", "-d", db, ...a], { env, stdio: "pipe" }).toString();
    const root = path.join(__dirname, "../..");
    execFileSync("dropdb", ["--force", "--if-exists", "-h", "127.0.0.1", "-U", "khoai_test", "khoai_up"], { env });
    execFileSync("createdb", ["-h", "127.0.0.1", "-U", "khoai_test", "khoai_up"], { env });
    psql("khoai_up", "-f", path.join(__dirname, "supabase_shim.sql"));
    for (const f of ["0001_schema", "0002_logic", "0003_read_api", "0004_security"]) psql("khoai_up", "-f", path.join(root, `supabase/migrations/${f}.sql`));
    psql("khoai_up", "-c", `
      insert into floors values ('T1','Tầng trệt',1);
      insert into dining_tables (code, floor_code, capacity) values ('A1','T1',4);
      insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000000aa','cu@x');
      insert into profiles (id, full_name, email, role) values ('00000000-0000-0000-0000-0000000000aa','Nhân Viên Cũ','cu@x','manager');
      insert into bookings (consultant_id, customer_name, customer_phone, start_at, end_at, party_size)
        values ('00000000-0000-0000-0000-0000000000aa','Khách Cũ','0900000009','2044-01-01T05:00:00Z','2044-01-01T06:00:00Z',2);`);
    psql("khoai_up", "-f", path.join(root, "supabase/migrations/0005_consultants_sources.sql"));
    psql("khoai_up", "-f", path.join(root, "supabase/migrations/0005_consultants_sources.sql"));   // chạy lại không lỗi
    const out = psql("khoai_up", "-tA", "-c", `set role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000aa"}',false);
      select (public.search_bookings('{}'::jsonb)->'rows'->0->>'consultant_name') || '|' || (select count(*) from lookups where kind='consultant');`);
    expect(out.split("\n").filter((l) => l.includes("|"))[0].trim()).toBe("Nhân Viên Cũ|4");
    execFileSync("dropdb", ["--force", "-h", "127.0.0.1", "-U", "khoai_test", "khoai_up"], { env });
  });
});
