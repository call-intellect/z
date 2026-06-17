"use client";

import { useTour } from "./useTour";

export function WelcomeTourAutoStart() {
  useTour("welcome");
  return null;
}
