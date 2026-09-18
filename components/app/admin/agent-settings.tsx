'use client';

/**
 * The agent's deadlines and the monthly spending ceilings, default and per
 * person (§08 t-53).
 *
 * Two parts, one page. The settings form replaces all three values at once —
 * the route requires it, because "first words shorter than the turn" is a rule
 * about the pair. The table under it is every account, from the single enriched
 * list endpoint, with each person's effective ceiling and whether it is their
 * own; setting or clearing one answers with the row as it now stands, so the
 * table updates without re-fetching.
 *
 * Deadlines are milliseconds on the wire and seconds on screen. The browser
 * checks the three invalid shapes before sending, for a quicker answer; the
 * route is what actually refuses them.
 *
 * Nothing on this page enforces anything yet — the page says so, because a
 * setting that looks live and is not is the thing `HB9` warns about.
 */

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FieldHelp } from '@/components/ui/field-help';
import { ClientDate } from '@/components/ui/client-date';
import { parseApiResponse } from '@/lib/api/parse-response';
import { parsePaginationMeta } from '@/lib/validations/common';
import type { PaginationMeta } from '@/types/api';
import type { AgentSettings, UserBudgetRow } from '@/lib/app/agent/settings';
import {
  AGENT_SETTINGS_ENDPOINT,
  USER_BUDGETS_ENDPOINT,
  userBudgetEndpoint,
} from '@/lib/app/agent/endpoint';
import {
  MAX_DEADLINE_MS,
  MAX_MONTHLY_CEILING_USD,
  USER_BUDGET_PAGE_SIZE,
} from '@/lib/validations/app-agent-settings';

/** Settings as they cross the wire — `updatedAt` is a string once serialised. */
type SettingsJson = Omit<AgentSettings, 'updatedAt'> & { updatedAt: string | Date | null };

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** The first message worth showing from an error envelope: a field's, else the top line. */
function errorMessage(error: { message: string; details?: unknown }): string {
  const details = error.details;
  if (details && typeof details === 'object' && 'errors' in details) {
    const errors = details.errors;
    if (Array.isArray(errors)) {
      const first: unknown = errors[0];
      if (first && typeof first === 'object' && 'message' in first) {
        const message = first.message;
        if (typeof message === 'string') return message;
      }
    }
  }
  return error.message;
}

/** A seconds field's text → whole milliseconds, or `null` when it is not a number. */
function secondsToMs(text: string): number | null {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  return Math.round(value * 1000);
}

/** A dollars field's text → a number, or `null` when it is not one. */
function parseUsd(text: string): number | null {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  return value;
}

/**
 * The browser's copy of the three refusals, so the admin hears about them
 * before a round trip. The route's schema is the authority.
 */
export function checkSettings(
  firstWordsMs: number | null,
  turnMs: number | null,
  ceilingUsd: number | null
): string | null {
  if (firstWordsMs === null || turnMs === null || ceilingUsd === null) {
    return 'Every field needs a number.';
  }
  if (firstWordsMs <= 0 || turnMs <= 0) return 'A deadline must be longer than zero.';
  if (firstWordsMs > MAX_DEADLINE_MS || turnMs > MAX_DEADLINE_MS) {
    return `A deadline cannot be longer than ${MAX_DEADLINE_MS / 1000} seconds.`;
  }
  if (firstWordsMs >= turnMs) {
    return 'The first-words deadline must be shorter than the whole turn’s — otherwise the turn ends before the app ever says it is slow.';
  }
  if (ceilingUsd < 0) return 'A ceiling cannot be negative.';
  if (ceilingUsd > MAX_MONTHLY_CEILING_USD) {
    return `A ceiling cannot be more than ${usd.format(MAX_MONTHLY_CEILING_USD)}.`;
  }
  return null;
}

export interface AgentSettingsPanelProps {
  initialSettings: SettingsJson | null;
  initialUsers: UserBudgetRow[];
  initialMeta: PaginationMeta;
  /** The server-side first load failed — the table must not claim "nobody". */
  initialLoadFailed: boolean;
}

export function AgentSettingsPanel({
  initialSettings,
  initialUsers,
  initialMeta,
  initialLoadFailed,
}: AgentSettingsPanelProps) {
  // Bumped when the settings save: every row on the default shows the default
  // as its limit, so the table has to re-read or it shows the old figure.
  const [settingsRevision, setSettingsRevision] = useState(0);

  return (
    <div className="space-y-8">
      <SettingsForm
        initialSettings={initialSettings}
        onSaved={() => setSettingsRevision((revision) => revision + 1)}
      />
      <BudgetTable
        settingsRevision={settingsRevision}
        initialUsers={initialUsers}
        initialMeta={initialMeta}
        initialLoadFailed={initialLoadFailed}
      />
    </div>
  );
}

function SettingsForm({
  initialSettings,
  onSaved,
}: {
  initialSettings: SettingsJson | null;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<SettingsJson | null>(initialSettings);
  const [firstWords, setFirstWords] = useState(
    initialSettings ? String(initialSettings.firstWordsDeadlineMs / 1000) : ''
  );
  const [turn, setTurn] = useState(
    initialSettings ? String(initialSettings.turnDeadlineMs / 1000) : ''
  );
  const [ceiling, setCeiling] = useState(
    initialSettings ? String(initialSettings.defaultMonthlyCeilingUsd) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaved(false);

    const firstWordsDeadlineMs = secondsToMs(firstWords);
    const turnDeadlineMs = secondsToMs(turn);
    const defaultMonthlyCeilingUsd = parseUsd(ceiling);
    const problem = checkSettings(firstWordsDeadlineMs, turnDeadlineMs, defaultMonthlyCeilingUsd);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(AGENT_SETTINGS_ENDPOINT, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstWordsDeadlineMs, turnDeadlineMs, defaultMonthlyCeilingUsd }),
      });
      const parsed = await parseApiResponse<{ settings: SettingsJson }>(response);
      if (!parsed.success) {
        setError(errorMessage(parsed.error));
        return;
      }
      setSettings(parsed.data.settings);
      setSaved(true);
      onSaved();
    } catch {
      setError('The settings did not save. Nothing was changed — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="agent-settings-heading" className="space-y-4">
      <div>
        <h3 id="agent-settings-heading" className="text-base font-semibold">
          Deadlines and the default limit
        </h3>
        <p className="text-muted-foreground text-sm">
          {settings?.updatedAt ? (
            <>
              Last changed <ClientDate date={new Date(settings.updatedAt)} showTime />.
            </>
          ) : settings ? (
            'Not stored yet — these are the ruled defaults. Saving stores them.'
          ) : (
            'The settings did not load. Reload the page before changing anything.'
          )}
        </p>
      </div>

      <form
        onSubmit={(event) => void onSubmit(event)}
        className="grid max-w-xl gap-4 sm:grid-cols-3"
        noValidate
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor="first-words-deadline">First words within (s)</Label>
            <FieldHelp title="First-words deadline">
              How long a turn may go without the first words of an answer before the app tells the
              person it is taking longer than usual. Must be shorter than the whole-turn deadline.
              Ruled default: 8 seconds.
            </FieldHelp>
          </div>
          <Input
            id="first-words-deadline"
            type="number"
            inputMode="decimal"
            min={0.5}
            step={0.5}
            value={firstWords}
            onChange={(event) => setFirstWords(event.target.value)}
            disabled={!settings || saving}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor="turn-deadline">Whole turn within (s)</Label>
            <FieldHelp title="Whole-turn deadline">
              The longest one turn may run, start to finish. At this point the turn is ended and the
              person is told plainly, with the chance to try again. Ruled default: 60 seconds.
            </FieldHelp>
          </div>
          <Input
            id="turn-deadline"
            type="number"
            inputMode="decimal"
            min={1}
            step={1}
            value={turn}
            onChange={(event) => setTurn(event.target.value)}
            disabled={!settings || saving}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor="default-ceiling">Monthly limit ($)</Label>
            <FieldHelp title="Default monthly limit">
              What one person may spend on the model in a calendar month, in US dollars, unless they
              have their own limit below. Zero means nothing at all. Ruled default: $5.
            </FieldHelp>
          </div>
          <Input
            id="default-ceiling"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            value={ceiling}
            onChange={(event) => setCeiling(event.target.value)}
            disabled={!settings || saving}
          />
        </div>

        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={!settings || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saved && !error && (
            <span role="status" className="text-muted-foreground text-sm">
              Saved.
            </span>
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm sm:col-span-3">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function BudgetTable({
  settingsRevision,
  initialUsers,
  initialMeta,
  initialLoadFailed,
}: {
  settingsRevision: number;
  initialUsers: UserBudgetRow[];
  initialMeta: PaginationMeta;
  initialLoadFailed: boolean;
}) {
  const [users, setUsers] = useState<UserBudgetRow[]>(initialUsers);
  const [meta, setMeta] = useState<PaginationMeta>(initialMeta);
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [overriddenOnly, setOverriddenOnly] = useState(false);
  const [page, setPage] = useState(1);
  const requestSeqRef = useRef(0);
  const firstRenderRef = useRef(true);

  const load = useCallback(async (q: string, onlyOverridden: boolean, pageNumber: number) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pageNumber),
        limit: String(USER_BUDGET_PAGE_SIZE),
        overriddenOnly: String(onlyOverridden),
      });
      if (q.trim()) params.set('q', q.trim());
      const response = await fetch(`${USER_BUDGETS_ENDPOINT}?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const parsed = await parseApiResponse<UserBudgetRow[]>(response);
      if (!parsed.success) throw new Error(parsed.error.message);
      if (requestSeqRef.current !== seq) return;
      setUsers(parsed.data);
      const parsedMeta = parsePaginationMeta(parsed.meta);
      if (parsedMeta) setMeta(parsedMeta);
      setLoadFailed(false);
    } catch {
      if (requestSeqRef.current !== seq) return;
      setLoadFailed(true);
    } finally {
      if (requestSeqRef.current === seq) setLoading(false);
    }
  }, []);

  // The server rendered page 1 unfiltered; fetch only once something changes.
  // Search is debounced so each keystroke is not a request.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const timer = setTimeout(() => void load(search, overriddenOnly, page), 300);
    return () => clearTimeout(timer);
  }, [search, overriddenOnly, page, settingsRevision, load]);

  const replaceRow = (row: UserBudgetRow) => {
    // A list read still in flight may predate this write; drop it rather than
    // let it put the old value back.
    requestSeqRef.current += 1;
    setLoading(false);
    setUsers((current) => current.map((user) => (user.userId === row.userId ? row : user)));
    // Cleared while showing only people with their own limit: they no longer
    // belong on this view, and the count has changed. Re-read it.
    if (overriddenOnly && row.overrideUsd === null) void load(search, overriddenOnly, page);
  };

  return (
    <section aria-labelledby="user-budgets-heading" className="space-y-4">
      <div>
        <h3 id="user-budgets-heading" className="text-base font-semibold">
          Each person&rsquo;s monthly limit
        </h3>
        <p className="text-muted-foreground text-sm">
          Everyone is on the default unless they have their own limit. Clearing someone&rsquo;s
          limit puts them back on the default — it does not set it to zero.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
            <Input
              aria-label="Search people"
              placeholder="Search by name or email"
              className="w-64 pl-8"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <FieldHelp title="Search">
            Matches any part of a person&rsquo;s name or email address. The search term is not
            logged.
          </FieldHelp>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="overridden-only"
            checked={overriddenOnly}
            onCheckedChange={(checked) => {
              setOverriddenOnly(checked);
              setPage(1);
            }}
          />
          <Label htmlFor="overridden-only">Only people with their own limit</Label>
          <FieldHelp title="Only people with their own limit">
            Hides everyone on the default, so the exceptions are all on one screen.
          </FieldHelp>
        </div>
      </div>

      {loadFailed && (
        <p role="alert" className="text-destructive text-sm">
          The list did not load. Reload the page — if it keeps failing, the budgets endpoint is the
          thing to check, not the table.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Limit now</th>
              <th className="px-3 py-2 font-medium">
                <span className="inline-flex items-center gap-1">
                  Their own limit ($)
                  <FieldHelp title="Their own limit">
                    Replaces the default for this one person, in US dollars a month. Zero means they
                    may spend nothing. <strong>Clear</strong> removes it and they go back to the
                    default.
                  </FieldHelp>
                </span>
              </th>
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {users.map((user) => (
              <BudgetRow key={user.userId} user={user} onChange={replaceRow} />
            ))}
            {users.length === 0 && !loadFailed && (
              <tr>
                <td colSpan={3} className="text-muted-foreground px-3 py-6 text-center">
                  {loading
                    ? 'Loading…'
                    : overriddenOnly
                      ? 'Nobody has their own limit — everyone is on the default.'
                      : 'No accounts match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous page"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => current - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Next page"
            disabled={page >= meta.totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </section>
  );
}

function BudgetRow({
  user,
  onChange,
}: {
  user: UserBudgetRow;
  onChange: (row: UserBudgetRow) => void;
}) {
  const [value, setValue] = useState(user.overrideUsd === null ? '' : String(user.overrideUsd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the row is replaced from outside (a page change, a reload).
  useEffect(() => {
    setValue(user.overrideUsd === null ? '' : String(user.overrideUsd));
  }, [user.overrideUsd]);

  const send = async (method: 'PUT' | 'DELETE') => {
    setError(null);
    let body: string | undefined;
    if (method === 'PUT') {
      const monthlyCeilingUsd = parseUsd(value);
      if (monthlyCeilingUsd === null) return setError('Enter an amount, or Clear.');
      if (monthlyCeilingUsd < 0) return setError('A limit cannot be negative.');
      if (monthlyCeilingUsd > MAX_MONTHLY_CEILING_USD) {
        return setError(`A limit cannot be more than ${usd.format(MAX_MONTHLY_CEILING_USD)}.`);
      }
      body = JSON.stringify({ monthlyCeilingUsd });
    }

    setBusy(true);
    try {
      const response = await fetch(userBudgetEndpoint(user.userId), {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
      });
      const parsed = await parseApiResponse<{ budget: UserBudgetRow }>(response);
      if (!parsed.success) return setError(errorMessage(parsed.error));
      onChange(parsed.data.budget);
    } catch {
      setError('That did not save. Nothing was changed — try again.');
    } finally {
      setBusy(false);
    }
  };

  const inputId = `budget-${user.userId}`;

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{user.name}</div>
        <div className="text-muted-foreground">{user.email}</div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {usd.format(user.effectiveCeilingUsd)}{' '}
        <Badge variant={user.overrideUsd === null ? 'outline' : 'secondary'}>
          {user.overrideUsd === null ? 'default' : 'own'}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={inputId} className="sr-only">
            Monthly limit for {user.name}
          </Label>
          <Input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            className="w-28"
            placeholder="Default"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
          />
          <Button size="sm" onClick={() => void send('PUT')} disabled={busy}>
            Set
          </Button>
          {user.overrideUsd !== null && (
            <Button size="sm" variant="outline" onClick={() => void send('DELETE')} disabled={busy}>
              Clear
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive mt-1 text-xs">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}
