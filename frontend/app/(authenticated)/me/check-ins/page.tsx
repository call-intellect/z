import type { Metadata } from "next";

import { MyCheckInsClient } from "./MyCheckInsClient";

export const metadata: Metadata = {
  title: "Мои чек-ины",
};

export default function MyCheckInsPage() {
  return <MyCheckInsClient />;
}
