import { getContext } from "@/lib/data";
import { SettingsAdmin } from "@/components/Admin";

export default async function Page() {
  const ctx = (await getContext()).data!;
  return <SettingsAdmin settings={ctx.settings} />;
}
