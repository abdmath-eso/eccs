import type { Metadata } from "next";

import { JoiningLetterPage } from "../joining-screen";

export const metadata: Metadata = { title: "Your appointment letter" };

export default function Page() {
  return <JoiningLetterPage />;
}
