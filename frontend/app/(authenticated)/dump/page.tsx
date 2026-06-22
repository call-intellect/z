import type { Metadata } from "next";

import { DumpClient } from "./DumpClient";

export const metadata: Metadata = {
  title: "Текстовая заметка",
};

export default function DumpPage() {
  return <DumpClient />;
}
