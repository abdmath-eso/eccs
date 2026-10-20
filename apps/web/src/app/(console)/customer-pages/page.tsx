import { redirect } from "next/navigation";

// The customer-page photos moved into Quality → Photos on 20 Oct 2026 (console plan step 3,
// decision 4), and Customer pages left the menu. An old address, a bookmark or a link in a
// message still works: it opens that queue with the same filter (show=).
export default async function Page({ searchParams }: PageProps<"/customer-pages">) {
  const asked = await searchParams;
  const kept = new URLSearchParams({ tab: "photos", queue: "customer" });
  for (const [key, value] of Object.entries(asked)) {
    if (key === "tab" || key === "queue") continue;
    for (const one of Array.isArray(value) ? value : [value]) if (one !== undefined) kept.append(key, one);
  }
  redirect(`/quality?${kept.toString()}`);
}
