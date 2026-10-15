import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import LeadScreen from "./lead-screen";

export const metadata: Metadata = { title: "Lead" };

// One lead, by its id in the address (/sales/leads/<id>). Which panel is open is kept in
// the web address too; Next.js asks for a Suspense boundary around anything that reads it.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <LeadScreen leadId={id} />
    </Suspense>
  );
}
