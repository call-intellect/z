import type { Metadata } from "next";

import { FeedbackDashboardClient } from "./FeedbackDashboardClient";

export const metadata: Metadata = {
  title: "Обратная связь пользователей",
};

export default function AdminFeedbackPage() {
  return <FeedbackDashboardClient />;
}
