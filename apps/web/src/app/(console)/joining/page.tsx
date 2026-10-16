import type { Metadata } from "next";

import { JoiningHome } from "./joining-screen";

export const metadata: Metadata = { title: "Joining ECCS" };

// A new team member's own joining page (16 Oct 2026): their steps, their documents, their first week.
export default function Page() {
  return <JoiningHome />;
}
