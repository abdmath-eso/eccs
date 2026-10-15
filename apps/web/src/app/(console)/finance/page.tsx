import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import FinanceScreen from "./finance-screen";

// The browser tab reads "Finance · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Finance" };

// The period, the budget compared with and the day shown are kept in the web address;
// Next.js asks for a Suspense boundary around anything that reads it in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <FinanceScreen />
    </Suspense>
  );
}
