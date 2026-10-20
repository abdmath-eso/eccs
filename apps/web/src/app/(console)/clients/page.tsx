import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import ClientsTabsScreen from "./clients-tabs-screen";

// The browser tab reads "Clients · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Clients" };

// The screen keeps its tab, filters and selection in the web address; Next.js asks
// for a Suspense boundary around anything that reads the address in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ClientsTabsScreen />
    </Suspense>
  );
}
