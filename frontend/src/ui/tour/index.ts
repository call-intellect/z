/**
 * Публичный API модуля onboarding-туров.
 *
 * Использование:
 *   ```tsx
 *   // app/(authenticated)/layout.tsx
 *   <TourProvider>{children}</TourProvider>
 *
 *   // app/(authenticated)/dashboard/page.tsx
 *   useTour('welcome');
 *   ```
 */

export { TourProvider, useTourContext, useTourContextOptional } from './TourProvider';
export { useTour } from './useTour';
export { WelcomeTourAutoStart } from './WelcomeTourAutoStart';
export type { TourId, TourDefinition, TourStep } from './types';
