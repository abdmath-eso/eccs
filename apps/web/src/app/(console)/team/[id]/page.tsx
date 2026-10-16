import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import MemberScreen from "./member-screen";

export const metadata: Metadata = { title: "Team member" };

// One team member, by their login's id in the address (/team/<id>).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <MemberScreen userId={id} />
    </Suspense>
  );
}
