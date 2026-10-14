/**
 * Every app route is behind the gate, or says why it is not (t-159).
 *
 * The shell layout keeps anyone who has not passed the gate out of the shell,
 * but the API is reachable by anyone signed in. `withGatedAuth`
 * (`lib/app/gateway/guard.ts`) is how a route asks the layout's question. This
 * file reads every `route.ts` under `app/api/v1/app/` and holds each exported
 * method to one of two answers: wrapped in `withGatedAuth`, or listed in
 * `EXEMPT` below with its reason. A route added without either fails here
 * naming itself — which is the point: the gap this closes was a route nobody
 * remembered to guard.
 *
 * It reads source rather than calling handlers, because the question is "does
 * this route ask?", and a handler test can only prove the routes someone
 * thought to test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'app/api/v1/app');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * `<route dir relative to app/api/v1/app> <METHOD>` → why it is not gated.
 *
 * Three kinds of reason belong here, and only these: the route IS the gate (or
 * is read by it); the route is public or machine-called and has no person
 * behind it; or the route lets a person take their data out or delete it, which
 * is never conditional on agreeing to a new version of the terms.
 */
const EXEMPT: Record<string, string> = {
  'acknowledgements GET': 'The gate page reads where the person stands — it IS the gate.',
  'acknowledgements POST': 'Recording an acknowledgement is how the gate is passed.',
  'content/documents GET': 'Public: the site and the gate page render the documents unsigned.',
  'content/documents/[id] GET': 'Public: the site and the gate page render the documents unsigned.',
  'content/journey-structure GET': 'Public: the landing page renders the journey unsigned.',
  'waitlist POST': 'Public: the waitlist form is for people with no account at all.',
  'cron/knowledge-mirror GET': 'Machine-called with CRON_SECRET; no person, so no gate to pass.',
  'journey-record/export GET':
    'Taking your journal out is not conditional on new terms (Art. 15/20).',
  'exchanges DELETE': 'Deleting what you said is not conditional on new terms (Art. 17).',
  'modules/[slug]/exchanges DELETE':
    "Deleting a module's worth is not conditional on new terms (Art. 17).",
  'sessions/[id] DELETE': 'Deleting a session is not conditional on new terms (Art. 17).',
  'notes DELETE':
    'Deleting what the app noted about you is not conditional on new terms (Art. 17).',
  'journey-record/[id] DELETE':
    'Deleting a journal entry is not conditional on new terms (Art. 17).',
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

interface RouteMethod {
  key: string;
  gated: boolean;
}

function exportedMethods(file: string): RouteMethod[] {
  const source = readFileSync(file, 'utf8');
  const route = path.relative(ROOT, path.dirname(file)).split(path.sep).join('/');
  return METHODS.flatMap((method) => {
    const declared = new RegExp(
      `export\\s+(?:const\\s+${method}\\s*=|async\\s+function\\s+${method}\\s*\\()`
    ).test(source);
    if (!declared) return [];
    const gated = new RegExp(`export\\s+const\\s+${method}\\s*=\\s*withGatedAuth\\b`).test(source);
    return [{ key: `${route} ${method}`, gated }];
  });
}

const ALL = routeFiles(ROOT).flatMap(exportedMethods);

describe('the gate covers the app API', () => {
  it('finds the routes it is checking', () => {
    // Guards the guard: a wrong root or a regex that matched nothing would pass
    // every assertion below for free.
    expect(ALL.length).toBeGreaterThan(30);
    expect(ALL.filter((m) => m.gated).length).toBeGreaterThan(20);
  });

  it.each(ALL.map((m) => [m.key, m] as const))('%s is gated or exempt with a reason', (key, m) => {
    if (m.gated) {
      expect(EXEMPT[key], `${key} is gated AND listed as exempt — drop it from EXEMPT`).toBe(
        undefined
      );
      return;
    }
    expect(
      EXEMPT[key],
      `${key} is neither wrapped in withGatedAuth nor listed in EXEMPT with a reason`
    ).toBeDefined();
  });

  it('lists no exemption for a route or method that does not exist', () => {
    const present = new Set(ALL.map((m) => m.key));
    const stale = Object.keys(EXEMPT).filter((key) => !present.has(key));
    expect(stale).toEqual([]);
  });

  it('gives every exemption a reason a reader can act on', () => {
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, key).toBeGreaterThanOrEqual(20);
    }
  });
});
