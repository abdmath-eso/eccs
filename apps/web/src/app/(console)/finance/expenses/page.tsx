import type { Metadata } from "next";
import { Suspense } from "react";

import { Loading } from "@/components/ui";

import ExpensesScreen from "./expenses-screen";

// The browser tab reads "Expense book · ECCS Console".
export const metadata: Metadata = { title: "Expense book" };

// The filters are kept in the web address; Next.js asks for a Suspense boundary around it.
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ExpensesScreen />
    </Suspense>
  );
}
