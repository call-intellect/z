import type { Metadata } from "next";

import { StorageClient } from "./StorageClient";

export const metadata: Metadata = {
  title: "S3 хранилище",
};

export default function AdminMediaStoragePage() {
  return <StorageClient />;
}
