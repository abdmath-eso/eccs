import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import CustomerPagesScreen from "./customer-pages-screen";

// The browser tab reads "Customer pages · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Customer pages" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <CustomerPagesScreen />
    </Suspense>
  );
}
