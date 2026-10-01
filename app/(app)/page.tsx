import { rpc } from "@/lib/data";
import { todayVn } from "@/lib/time";
import type { Board } from "@/lib/types";
import { getContext } from "@/lib/data";
import { BoardClient } from "@/components/Board";
import { RetryCard } from "@/components/RetryCard";

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = (await getContext()).data!;
  const date = isDate(sp.date) ? sp.date : todayVn();
  const { data: board, error } = await rpc<Board>("get_board", { p_day: date });
  if (error || !board) return <RetryCard message="Chưa tải được danh sách bàn. Hãy kiểm tra mạng rồi thử lại." />;
  return (
    <BoardClient
      board={board}
      date={date}
      from={isTime(sp.from) ? sp.from : ctx.settings.open_time.slice(0, 5)}
      to={isTime(sp.to) ? sp.to : ctx.settings.close_time.slice(0, 5)}
    />
  );
}
