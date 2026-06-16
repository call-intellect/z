import type { Metadata } from "next";

import { DepartmentsClient } from "./DepartmentsClient";

export const metadata: Metadata = {
  title: "Отделы",
};

export default function DepartmentsPage() {
  return <DepartmentsClient />;
}
