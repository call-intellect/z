import type { Metadata } from "next";

import { MaturityClient } from "./MaturityClient";

export const metadata: Metadata = {
  title: "Зрелость компании",
};

export default function MaturityPage() {
  return <MaturityClient />;
}
