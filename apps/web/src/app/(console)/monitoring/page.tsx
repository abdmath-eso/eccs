import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import MonitoringScreen from "./monitoring-screen";

// The browser tab reads "Monitoring · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Monitoring" };

// The screen keeps its filters and the chosen outlet in the web address; Next.js asks
// for a Suspense boundary around anything that reads the address in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <MonitoringScreen />
    </Suspense>
  );
}
