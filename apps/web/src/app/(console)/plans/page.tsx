import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import PlansScreen from "./plans-screen";

// The browser tab reads "Plans · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Plans" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PlansScreen />
    </Suspense>
  );
}
