import type { Metadata } from "next";

import { FeedClient } from "./FeedClient";

export const metadata: Metadata = {
  title: "Лента Коры",
};

export default function FeedPage() {
  return <FeedClient />;
}
