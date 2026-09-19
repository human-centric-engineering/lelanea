/**
 * Which services a person in danger is shown, and the frame that carries them
 * (f-safety t-58). Reads the real authored file, so a change to the table that
 * breaks a region fails here.
 */

import { describe, it, expect } from 'vitest';

import { getCrisisResources } from '@/lib/app/content/crisis-resources';
import {
  crisisFrame,
  crisisResourceText,
  regionOfLocale,
  resolveCrisisResource,
} from '@/lib/app/safety/resource';

const INTERNATIONAL = 'Find A Helpline';

describe('regionOfLocale', () => {
  it.each([
    ['en-GB', 'GB'],
    ['en_us', 'US'],
    ['zh-Hant-TW', 'TW'],
    ['pt-br', 'BR'],
  ])('reads %s as %s', (locale, region) => {
    expect(regionOfLocale(locale)).toBe(region);
  });

  it.each([['en'], ['es-419'], ['zh-Hant'], [null]])('names no country for %s', (locale) => {
    expect(regionOfLocale(locale)).toBeNull();
  });
});

describe('resolveCrisisResource', () => {
  it('names the region’s own services first, then the international directory', () => {
    const uk = resolveCrisisResource('en-GB', 'hard');
    expect(uk.region).toBe('GB');
    expect(uk.services.map((s) => s.name)).toEqual(['Samaritans', 'Shout', INTERNATIONAL]);
    expect(uk.emergency).toContain('999');
  });

  it('chooses by region, not by language: en-US and en-GB get different services', () => {
    const us = resolveCrisisResource('en-US', 'hard');
    expect(us.region).toBe('US');
    expect(us.services[0]?.contact).toContain('988');
    expect(us.emergency).toContain('911');
    expect(us.services[0]?.name).not.toBe(resolveCrisisResource('en-GB', 'hard').services[0]?.name);
  });

  it.each([
    ['a region the table does not list', 'fr-FR'],
    ['a tag with no region', 'en'],
    ['no preference at all', null],
  ])('falls back to the directory and the local emergency line for %s', (_label, locale) => {
    const resource = resolveCrisisResource(locale, 'hard');
    expect(resource.region).toBeNull();
    expect(resource.services).toEqual([
      expect.objectContaining({ name: INTERNATIONAL, url: 'https://findahelpline.com' }),
    ]);
    // No number is guessed for someone whose country is unknown.
    expect(resource.emergency).toBe(getCrisisResources().copy.emergency);
    expect(resource.emergency).toMatch(/local emergency number/);
  });

  it('carries the draft marker while the content awaits sign-off', () => {
    expect(getCrisisResources().resources.provenance.status).toBe('draft');
    expect(resolveCrisisResource('en-GB', 'soft').status).toBe('draft');
  });

  it('tells a hard-tier reader their message is kept; a soft one carries on', () => {
    expect(resolveCrisisResource('en-GB', 'hard').keptMessage).toMatch(/still in the box/);
    expect(resolveCrisisResource('en-GB', 'soft').keptMessage).toBeNull();
    expect(resolveCrisisResource('en-GB', 'soft').intro).not.toBe(
      resolveCrisisResource('en-GB', 'hard').intro
    );
  });
});

describe('crisisFrame', () => {
  it('ends the turn on a hard hit: an error frame with the crisis code', () => {
    const frame = crisisFrame(resolveCrisisResource('en-GB', 'hard'));
    expect(frame.type).toBe('error');
    expect(frame.code).toBe('crisis');
  });

  it('leads the turn on a soft hit: a warning frame, so her turn can follow', () => {
    const frame = crisisFrame(resolveCrisisResource('en-GB', 'soft'));
    expect(frame.type).toBe('warning');
    expect(frame.code).toBe('crisis');
  });

  it('puts every name and contact in the plain-text message, for a client that renders nothing else', () => {
    const resource = resolveCrisisResource('en-AU', 'hard');
    const text = crisisResourceText(resource);
    expect(resource.services.length).toBeGreaterThan(1);
    for (const service of resource.services) {
      expect(text).toContain(service.name);
      expect(text).toContain(service.contact);
    }
    expect(text).toContain(resource.emergency);
    expect(crisisFrame(resource).message).toBe(text);
  });
});

describe('the authored table', () => {
  it('lists every region once, each with at least one service', () => {
    const { regions } = getCrisisResources();
    expect(regions.length).toBeGreaterThan(3);
    expect(new Set(regions.map((r) => r.region)).size).toBe(regions.length);
    for (const region of regions) expect(region.services.length).toBeGreaterThan(0);
  });
});
