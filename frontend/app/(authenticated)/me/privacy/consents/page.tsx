import type { Metadata } from "next";

import { ConsentsListClient } from "./ConsentsListClient";

export const metadata: Metadata = {
  title: "Приватность · мои согласия",
};

export default function MyPrivacyConsentsPage() {
  return <ConsentsListClient />;
}
