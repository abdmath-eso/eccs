import type { Metadata } from "next";

import HandbookScreen from "./handbook-screen";

export const metadata: Metadata = { title: "Staff handbook" };

export default function Page() {
  return <HandbookScreen />;
}
