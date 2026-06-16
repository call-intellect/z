"use client";

export function TourBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px]"
    />
  );
}
