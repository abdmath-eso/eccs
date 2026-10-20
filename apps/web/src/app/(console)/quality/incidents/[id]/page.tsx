import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import IncidentScreen from "./incident-screen";

export const metadata: Metadata = { title: "Incident" };

// One incident, by its id in the address (/quality/incidents/<id>): "one link has the whole story".
// In this version of Next.js `params` is a promise, awaited here on the server.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <IncidentScreen incidentId={id} />
    </Suspense>
  );
}
