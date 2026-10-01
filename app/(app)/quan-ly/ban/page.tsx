import { getContext, rpc } from "@/lib/data";
import { TablesAdmin } from "@/components/Admin";
import { RetryCard } from "@/components/RetryCard";

export default async function Page() {
  const { data, error } = await rpc<any[]>("get_all_tables");
  const ctx = (await getContext()).data!;
  if (error || !data) return <RetryCard message="Chưa tải được danh mục bàn." />;
  return <TablesAdmin tables={data} floors={ctx.floors} />;
}
