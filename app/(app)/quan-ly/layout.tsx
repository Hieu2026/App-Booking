import { redirect } from "next/navigation";
import { getContext } from "@/lib/data";
import { AdminTabs } from "@/components/Admin";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const ctx = (await getContext()).data;
  if (ctx?.me.role !== "manager") redirect("/");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-leaf-900 sm:text-2xl">Quản lý</h1>
      <AdminTabs />
      {children}
    </div>
  );
}
