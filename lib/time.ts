// Múi giờ Việt Nam (UTC+7, không có giờ mùa hè). Mọi thời gian lưu ở CSDL dạng UTC (timestamptz).
export const TZ = "Asia/Ho_Chi_Minh";
const OFFSET_MS = 7 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → thành phần theo giờ Việt Nam */
export function vnParts(iso: string | Date) {
  const t = (typeof iso === "string" ? new Date(iso) : iso).getTime() + OFFSET_MS;
  const d = new Date(t);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(),
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}
/** "2030-05-04" + "18:30" (giờ VN) → ISO có múi giờ */
export const fromVn = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`).toISOString();
export const todayVn = (now: Date = new Date()) => vnParts(now).date;
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const timeOf = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
export const fmtTime = (iso: string) => vnParts(iso).time;
export const fmtDate = (isoOrDate: string) => {
  const p = isoOrDate.length === 10 ? { d: +isoOrDate.slice(8), m: +isoOrDate.slice(5, 7), y: +isoOrDate.slice(0, 4) } : vnParts(isoOrDate);
  return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
};
export const fmtDateTime = (iso: string) => `${fmtTime(iso)} ${fmtDate(iso)}`;
export function fmtDateLong(date: string) {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${WEEKDAYS[wd]}, ${fmtDate(date)}`;
}
/** Làm tròn xuống bội số của `step` phút */
export const floorTo = (mins: number, step = 30) => Math.floor(mins / step) * step;
export const nowMinutes = (now: Date = new Date()) => { const p = vnParts(now); return p.hh * 60 + p.mm; };
/** Ngày giờ VN dạng Date "bình" cho Excel (giờ tường giữ nguyên, không lệch múi giờ) */
export function wallDate(iso: string) {
  const p = vnParts(iso);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm));
}
export const fmtMoney = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === "" ? "" : new Intl.NumberFormat("vi-VN").format(Number(n)) + " đ";
