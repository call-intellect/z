import { SetMetadata } from '@nestjs/common';

import type { FeatureKey } from './tier-config';

export const REQUIRE_ENTITLEMENT_KEY = 'requireEntitlement';

export const RequireEntitlement = (feature: FeatureKey): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ENTITLEMENT_KEY, feature);
