import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import TeamScreen from "./team-screen";

// The browser tab reads "Team · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Team" };

// The role chosen is kept in the web address; Next.js asks for a Suspense boundary around anything that reads it.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <TeamScreen />
    </Suspense>
  );
}
