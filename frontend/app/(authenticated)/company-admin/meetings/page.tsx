import type { Metadata } from "next";

import { MeetingsAdminSettingsClient } from "./MeetingsAdminSettingsClient";

export const metadata: Metadata = {
  title: "Админка компании — Встречи",
};

export default function CompanyAdminMeetingsPage() {
  return <MeetingsAdminSettingsClient />;
}
