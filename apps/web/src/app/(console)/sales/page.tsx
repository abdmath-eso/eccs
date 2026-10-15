import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import SalesScreen from "./sales-screen";

// The browser tab reads "Sales · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Sales" };

// The person the page is narrowed to is kept in the web address; Next.js asks for a
// Suspense boundary around anything that reads it in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SalesScreen />
    </Suspense>
  );
}
