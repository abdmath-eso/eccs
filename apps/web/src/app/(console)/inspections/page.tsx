import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import InspectionsScreen from "./inspections-screen";

// The browser tab reads "Inspections · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Inspections" };

// The screen keeps its filter and selection in the web address; Next.js asks
// for a Suspense boundary around anything that reads the address in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <InspectionsScreen />
    </Suspense>
  );
}
