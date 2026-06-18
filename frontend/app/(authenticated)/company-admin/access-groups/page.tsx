import type { Metadata } from "next";

import { AccessGroupsClient } from "./AccessGroupsClient";

export const metadata: Metadata = {
  title: "Группы доступа к знаниям",
};

export default function AccessGroupsPage() {
  return <AccessGroupsClient />;
}
