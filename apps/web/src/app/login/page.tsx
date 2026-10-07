import type { Metadata } from "next";

import LoginScreen from "./login-screen";

// The browser tab reads "Log in · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Log in" };

export default function Page() {
  return <LoginScreen />;
}
