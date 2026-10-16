import type { Metadata } from "next";

import { JoiningHandbookPage } from "../joining-screen";

export const metadata: Metadata = { title: "Staff handbook" };

export default function Page() {
  return <JoiningHandbookPage />;
}
