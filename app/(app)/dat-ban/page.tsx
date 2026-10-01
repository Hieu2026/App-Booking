import { getContext, rpc } from "@/lib/data";
import { parseSearch } from "@/lib/search";
import type { Booking } from "@/lib/types";
import { SearchClient } from "@/components/SearchClient";
import { RetryCard } from "@/components/RetryCard";

const PAGE = 50;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = parseSearch(await searchParams);
  const ctx = (await getContext()).data!;
  const { data, error } = await rpc<{ total: number; total_guests: number; total_deposit: string | number; rows: Booking[] }>("search_bookings", {
    p_filters: p.filters, p_sort: p.sort, p_dir: p.dir, p_limit: PAGE, p_offset: (p.page - 1) * PAGE,
  });
  if (error || !data) return <RetryCard message="Chưa tải được danh sách. Hãy kiểm tra mạng rồi thử lại." />;
  return <SearchClient params={p} result={data} pageSize={PAGE} floors={ctx.floors} staff={ctx.staff} lookups={ctx.lookups} />;
}
