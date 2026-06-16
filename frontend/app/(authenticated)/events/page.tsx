import type { Metadata } from "next";

import { EventsListClient } from "./EventsListClient";

export const metadata: Metadata = {
  title: "События",
};

export default function EventsPage() {
  return <EventsListClient />;
}
