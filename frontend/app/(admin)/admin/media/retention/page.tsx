import type { Metadata } from "next";

import { RetentionClient } from "./RetentionClient";

export const metadata: Metadata = {
  title: "Сроки хранения",
};

export default function AdminMediaRetentionPage() {
  return <RetentionClient />;
}
