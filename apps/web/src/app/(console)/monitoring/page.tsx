import { redirect } from "next/navigation";

// Monitoring became Clients' Health tab on 20 Oct 2026 (the console plan). An old address,
// a bookmark or a link in a message still works: it opens Health with the same filters and
// the same outlet open (days=, show=, q=, sort=, dir=, outlet=).
export default async function Page({ searchParams }: PageProps<"/monitoring">) {
  const asked = await searchParams;
  const kept = new URLSearchParams({ tab: "health" });
  for (const [key, value] of Object.entries(asked)) {
    if (key === "tab") continue;
    for (const one of Array.isArray(value) ? value : [value]) if (one !== undefined) kept.append(key, one);
  }
  redirect(`/clients?${kept.toString()}`);
}
