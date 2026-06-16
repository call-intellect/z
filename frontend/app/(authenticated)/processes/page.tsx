import type { Metadata } from "next";

import { ProcessTemplatesClient } from "./ProcessTemplatesClient";

export const metadata: Metadata = {
  title: "Процессы",
};

export default function ProcessesPage() {
  return <ProcessTemplatesClient />;
}
