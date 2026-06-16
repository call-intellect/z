import type { Metadata } from "next";

import { IdeasListClient } from "./IdeasListClient";

export const metadata: Metadata = {
  title: "Идеи",
};

export default function IdeasPage() {
  return <IdeasListClient />;
}
