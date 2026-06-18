import type { Metadata } from "next";

import { BrandVoiceClient } from "./BrandVoiceClient";

export const metadata: Metadata = {
  title: "Голос бренда",
};

export default function BrandVoicePage() {
  return <BrandVoiceClient />;
}
