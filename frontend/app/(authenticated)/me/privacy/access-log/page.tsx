import type { Metadata } from "next";

import { AccessLogClient } from "./AccessLogClient";

export const metadata: Metadata = {
  title: "Приватность · история просмотров",
};

export default function MyPrivacyAccessLogPage() {
  return <AccessLogClient />;
}
