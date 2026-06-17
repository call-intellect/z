import type { Metadata } from "next";

import { CurationQueueClient } from "./CurationQueueClient";

export const metadata: Metadata = {
  title: "Проверка карточек",
};

export default function CurationPage() {
  return <CurationQueueClient />;
}
