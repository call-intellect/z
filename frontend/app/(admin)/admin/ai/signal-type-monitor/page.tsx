import type { Metadata } from "next";

import { SignalTypeMonitorClient } from "./SignalTypeMonitorClient";

export const metadata: Metadata = {
  title: "Signal-type monitor",
};

export default function AdminSignalTypeMonitorPage() {
  return <SignalTypeMonitorClient />;
}
