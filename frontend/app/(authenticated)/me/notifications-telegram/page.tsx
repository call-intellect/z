import type { Metadata } from "next";

import { NotificationsTelegramClient } from "./NotificationsTelegramClient";

export const metadata: Metadata = {
  title: "Уведомления в Telegram",
};

export default function NotificationsTelegramPage() {
  return <NotificationsTelegramClient />;
}
