import { getContext } from "@/lib/data";
import { LookupsAdmin } from "@/components/Admin";

export default async function Page() {
  const ctx = (await getContext()).data!;
  return <LookupsAdmin lookups={ctx.lookups} />;
}
