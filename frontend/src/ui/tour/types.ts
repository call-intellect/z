export type TourId = "welcome" | "project" | "meeting" | "overview" | "demo";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

export interface TourStepAction {
  label: string;
  kind: "next" | "prev" | "skip" | "complete" | "navigate";
  href?: string;
}

export interface TourStep {
  id: string;
  target: string;
  title: string;
  body: string;
  placement: TourPlacement;
  primaryAction: TourStepAction;
  secondaryAction?: TourStepAction;
}

export interface TourDefinition {
  id: TourId;
  steps: TourStep[];
}
