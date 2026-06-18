import type { Metadata } from "next";

import { ImportTrackerClient } from "./ImportTrackerClient";

export const metadata: Metadata = {
  title: "Импорт задач из других трекеров",
};

export default function ImportTrackerPage() {
  return <ImportTrackerClient />;
}
