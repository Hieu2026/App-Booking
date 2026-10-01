import { BookingForm } from "@/components/BookingForm";

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ok = (s?: string, re = /^\d{4}-\d{2}-\d{2}$/) => (s && re.test(s) ? s : undefined);
  return (
    <BookingForm
      prefill={{
        date: ok(sp.date), from: ok(sp.from, /^\d{2}:\d{2}$/), to: ok(sp.to, /^\d{2}:\d{2}$/),
        tableId: ok(sp.table, /^[0-9a-f-]{36}$/i), walkIn: sp.walkin === "1",
      }}
    />
  );
}
