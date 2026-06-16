import type { Metadata } from "next";

import { NotificationsClient } from "./NotificationsClient";

export const metadata: Metadata = {
  title: "Уведомления",
};

export default function MeNotificationsPage() {
  return <NotificationsClient />;
}
