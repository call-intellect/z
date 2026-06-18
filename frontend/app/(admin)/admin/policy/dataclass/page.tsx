import type { Metadata } from "next";

import { DataClassPolicyClient } from "./DataClassPolicyClient";

export const metadata: Metadata = {
  title: "Политика DataClass",
};

export default function AdminPolicyDataClassPage() {
  return <DataClassPolicyClient />;
}
