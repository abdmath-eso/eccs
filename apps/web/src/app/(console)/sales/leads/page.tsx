import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import LeadsScreen from "./leads-screen";

export const metadata: Metadata = { title: "Leads" };

// The filters are kept in the web address; Next.js asks for a Suspense boundary around anything that reads it in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <LeadsScreen />
    </Suspense>
  );
}
