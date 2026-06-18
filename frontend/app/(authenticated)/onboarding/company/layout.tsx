import type { ReactNode } from "react";
import type { Metadata } from "next";
import { WizardShell } from "./WizardShell";

export const metadata: Metadata = {
  title: "Знакомство с компанией",
};

export default function OnboardingCompanyLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <WizardShell>{children}</WizardShell>;
}
