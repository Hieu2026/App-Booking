import { rpc } from "@/lib/data";
import { AccountsAdmin } from "@/components/Admin";
import { RetryCard } from "@/components/RetryCard";

export default async function Page() {
  const { data, error } = await rpc<any[]>("get_profiles");
  if (error || !data) return <RetryCard message="Chưa tải được danh sách tài khoản." />;
  return <AccountsAdmin profiles={data} />;
}
