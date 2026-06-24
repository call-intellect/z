import type { Metadata } from "next";

import { SubjectMemoryClient } from "./SubjectMemoryClient";

export const metadata: Metadata = {
  title: "Что Кора выучила",
};

export default function SubjectMemoryPage() {
  return <SubjectMemoryClient />;
}
