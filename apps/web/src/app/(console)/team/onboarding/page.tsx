import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import TemplatesScreen from "./templates-screen";

export const metadata: Metadata = { title: "Onboarding checklist" };

// The role chosen is kept in the web address; Next.js asks for a Suspense boundary around anything that reads it.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <TemplatesScreen />
    </Suspense>
  );
}
