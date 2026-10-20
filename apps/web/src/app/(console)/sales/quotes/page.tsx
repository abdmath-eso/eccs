import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import QuotesScreen from "./quotes-screen";

// The browser tab reads "Quotes · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Quotes" };

// The filters are kept in the web address; Next.js asks for a Suspense boundary around anything that reads it in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <QuotesScreen />
    </Suspense>
  );
}
