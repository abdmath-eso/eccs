import type { Metadata } from "next";

import { JoiningDetailsPage } from "../joining-screen";

export const metadata: Metadata = { title: "Your details" };

export default function Page() {
  return <JoiningDetailsPage />;
}
