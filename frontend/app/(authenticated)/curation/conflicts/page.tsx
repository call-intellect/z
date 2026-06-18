import type { Metadata } from "next";

import { ConflictsListClient } from "./ConflictsListClient";

export const metadata: Metadata = {
  title: "Конфликты курации",
};

export default function ConflictsListPage() {
  return <ConflictsListClient />;
}
