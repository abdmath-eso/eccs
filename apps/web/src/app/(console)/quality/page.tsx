import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import QualityScreen from "./quality-screen";

// The browser tab reads "Quality · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Quality" };

// The screen keeps its tab, filters and the open follow-up in the web address; Next.js asks
// for a Suspense boundary around anything that reads the address in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <QualityScreen />
    </Suspense>
  );
}
