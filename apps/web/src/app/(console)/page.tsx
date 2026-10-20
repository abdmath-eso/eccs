import type { Metadata } from "next";
import { redirect } from "next/navigation";

import TodayScreen from "./today-screen";

// The browser tab reads "Today · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Today" };

/**
 * The console's home: Today (step 2 of the console plan, 20 Oct 2026). The frame (layout.tsx)
 * sends anyone without a Today (a BDE) to their own start page. Until 20 Oct "/" was Clients, so
 * an old address with a client or an onboarding in it (`/?client=…`, `/?onboard=1&lead=…`) still
 * opens All clients, keeping its query.
 */
export default async function Page({ searchParams }: PageProps<"/">) {
  const kept = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : [value]) if (one !== undefined) kept.append(key, one);
  }
  if (kept.has("client") || kept.has("onboard")) {
    if (!kept.has("tab")) kept.set("tab", "all");
    redirect(`/clients?${kept.toString()}`);
  }
  return <TodayScreen />;
}
