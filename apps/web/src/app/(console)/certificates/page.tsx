import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import CertificatesScreen from "./certificates-screen";

// The browser tab reads "Certificates · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Certificates" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <CertificatesScreen />
    </Suspense>
  );
}
