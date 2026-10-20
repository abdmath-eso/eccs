import { redirect } from "next/navigation";

// The console's home. Clients moved to /clients on 20 Oct 2026 (the console plan); until the
// Today page takes this address (step 2 of the plan), "/" simply opens Clients. The frame
// (layout.tsx) then sends anyone who does not onboard restaurants to their own start page.
// An old address with a client or an onboarding in it (`/?client=…`, `/?onboard=1&lead=…`)
// keeps its query, and Clients opens All clients for it.
export default async function Page({ searchParams }: PageProps<"/">) {
  const kept = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : [value]) if (one !== undefined) kept.append(key, one);
  }
  const query = kept.toString();
  redirect(query ? `/clients?${query}` : "/clients");
}
