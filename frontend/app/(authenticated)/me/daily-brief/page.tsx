import type { Metadata } from "next";

import { MyDailyBriefClient } from "./MyDailyBriefClient";

export const metadata: Metadata = {
  title: "Твой день",
};

export default function MyDailyBriefPage() {
  return <MyDailyBriefClient />;
}
