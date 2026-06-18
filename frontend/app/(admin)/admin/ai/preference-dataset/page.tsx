import type { Metadata } from "next";

import { PreferenceDatasetClient } from "./PreferenceDatasetClient";

export const metadata: Metadata = {
  title: "Preference dataset",
};

export default function AdminPreferenceDatasetPage() {
  return <PreferenceDatasetClient />;
}
