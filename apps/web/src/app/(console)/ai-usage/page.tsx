import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import AiUsageScreen from "./ai-usage-screen";

// The browser tab reads "AI usage · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "AI usage" };

// The tab, the period and the filters are kept in the web address; Next.js asks for a
// Suspense boundary around anything that reads it in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <AiUsageScreen />
    </Suspense>
  );
}
