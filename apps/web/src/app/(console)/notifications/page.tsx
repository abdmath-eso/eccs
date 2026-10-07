import type { Metadata } from "next";

import NotificationsScreen from "./notifications-screen";

// The browser tab reads "Notifications · ECCS Console" (the second half comes from the root layout).
export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return <NotificationsScreen />;
}
