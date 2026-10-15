import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import LogsScreen from "./logs-screen";

// The browser tab reads "Logs · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Logs" };

// The screen keeps its filters and the open event in the web address; Next.js asks
// for a Suspense boundary around anything that reads the address in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <LogsScreen />
    </Suspense>
  );
}
