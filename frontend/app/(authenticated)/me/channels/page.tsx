import type { Metadata } from "next";

import { ChannelsClient } from "./ChannelsClient";

export const metadata: Metadata = {
  title: "Мои каналы",
};

export default function MeChannelsPage() {
  return <ChannelsClient />;
}
