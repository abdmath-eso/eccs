import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import CatalogueScreen from "./catalogue-screen";

// The browser tab reads "Catalogue · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Catalogue" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <CatalogueScreen />
    </Suspense>
  );
}
