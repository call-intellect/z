import type { Metadata } from "next";
import type { ReactElement } from "react";

import { AssistantClient } from "./AssistantClient";

export const metadata: Metadata = {
  title: "Concierge — помощник кабинета",
};

export default function AssistantPage(): ReactElement {
  return <AssistantClient />;
}
