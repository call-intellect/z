import type { Metadata } from "next";

import { IntakeClient } from "./IntakeClient";

export const metadata: Metadata = {
  title: "Входящие",
};

export default function IntakePage() {
  return <IntakeClient />;
}
