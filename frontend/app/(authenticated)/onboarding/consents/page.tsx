import type { Metadata } from "next";

import { ConsentsClient } from "./ConsentsClient";

export const metadata: Metadata = {
  title: "Согласия",
};

export default function OnboardingConsentsPage() {
  return <ConsentsClient />;
}
