import type { Metadata } from "next";

import { DumpClient } from "./DumpClient";

export const metadata: Metadata = {
  title: "Дамп мысли",
};

export default function DumpPage() {
  return <DumpClient />;
}
