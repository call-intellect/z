import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VERSION: string = (() => {
  try {
    return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
  }
})();

export function GET(): NextResponse {
  return NextResponse.json({ version: VERSION });
}
