import { describe, expect, it } from 'vitest';

import { BASE_FUNCTIONAL_DOMAINS, INDUSTRY_DOMAIN_TEMPLATES } from './functional-domain.seeds';

describe('FunctionalDomainSeeds', () => {
  it('включает ровно 8 базовых доменов', () => {
    expect(BASE_FUNCTIONAL_DOMAINS.length).toBe(8);
  });

  it('все базовые домены имеют уникальный slug', () => {
    const slugs = BASE_FUNCTIONAL_DOMAINS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('per-industry domain.parentSlug ссылается только на BASE-домены', () => {
    const baseSlugs = new Set(BASE_FUNCTIONAL_DOMAINS.map((b) => b.slug));
    for (const [industry, list] of Object.entries(INDUSTRY_DOMAIN_TEMPLATES)) {
      for (const item of list) {
        if (item.parentSlug) {
          expect(
            baseSlugs.has(item.parentSlug),
            `industry=${industry} item=${item.slug} parent=${item.parentSlug}`,
          ).toBe(true);
        }
      }
    }
  });

  it('все 5 индустрий присутствуют', () => {
    const expected = ['saas', 'developer', 'retail', 'manufacturing', 'b2b_services'];
    for (const slug of expected) {
      expect(
        INDUSTRY_DOMAIN_TEMPLATES[slug as keyof typeof INDUSTRY_DOMAIN_TEMPLATES],
      ).toBeDefined();
    }
  });

  it('в каждой индустрии минимум 3 домена', () => {
    for (const [industry, list] of Object.entries(INDUSTRY_DOMAIN_TEMPLATES)) {
      expect(list.length, `industry=${industry}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('все per-industry slug-и не пересекаются с базовыми', () => {
    const baseSlugs = new Set(BASE_FUNCTIONAL_DOMAINS.map((b) => b.slug));
    for (const [industry, list] of Object.entries(INDUSTRY_DOMAIN_TEMPLATES)) {
      for (const item of list) {
        expect(
          baseSlugs.has(item.slug),
          `industry=${industry} item.slug=${item.slug} collides with base`,
        ).toBe(false);
      }
    }
  });
});
