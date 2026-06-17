import type { Metadata } from "next";

import { FeatureFlagsClient } from "./FeatureFlagsClient";

export const metadata: Metadata = {
  title: "Feature flags",
};

export default function AdminPlatformFlagsPage() {
  return <FeatureFlagsClient />;
}
