import { rpc } from "@/lib/data";
import { AuditAdmin } from "@/components/Admin";
import { RetryCard } from "@/components/RetryCard";

const PAGE = 50;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const entity = ["booking", "table", "lookup", "settings", "profile"].includes(sp.entity ?? "") ? sp.entity! : "";
  const q = (sp.q ?? "").slice(0, 80);
  const { data, error } = await rpc<{ total: number; rows: any[] }>("get_audit_log", {
    p_filters: { entity: entity || null, q: q || null }, p_limit: PAGE, p_offset: (page - 1) * PAGE,
  });
  if (error || !data) return <RetryCard message="Chưa tải được nhật ký." />;
  return <AuditAdmin data={data} page={page} pageSize={PAGE} entity={entity} q={q} />;
}
