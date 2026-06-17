import type { Metadata } from "next";

import { ClonesAccessClient } from "./ClonesAccessClient";

export const metadata: Metadata = {
  title: "Доступы к клонам",
};

export default function AdminClonesPage() {
  return <ClonesAccessClient />;
}
