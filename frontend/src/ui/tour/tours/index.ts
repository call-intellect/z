/**
 * Реестр всех туров. TourProvider импортирует отсюда, чтобы добавление
 * нового тура было однострочной правкой.
 */

import type { TourDefinition, TourId } from '../types';
import { demoTour } from './demo';
import { meetingTour } from './meeting';
import { overviewTour } from './overview';
import { projectTour } from './project';
import { welcomeTour } from './welcome';

export const TOUR_REGISTRY: Record<TourId, TourDefinition> = {
  welcome: welcomeTour,
  project: projectTour,
  meeting: meetingTour,
  overview: overviewTour,
  demo: demoTour,
};

export { welcomeTour, projectTour, meetingTour, overviewTour, demoTour };
