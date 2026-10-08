import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import InvoicesScreen from "./invoices-screen";

// The browser tab reads "Invoices · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Invoices" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <InvoicesScreen />
    </Suspense>
  );
}
