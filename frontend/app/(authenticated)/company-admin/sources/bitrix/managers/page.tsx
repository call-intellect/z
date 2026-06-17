import type { Metadata } from "next";

import { BitrixManagersClient } from "./BitrixManagersClient";

export const metadata: Metadata = {
  title: "Bitrix24: сопоставление сотрудников",
};

export default function BitrixManagersPage() {
  return <BitrixManagersClient />;
}
