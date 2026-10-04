'use client';

import { useEffect, useId, useState } from 'react';

import { Chip } from '@/components/app/ui/chip';
import { useTheme } from '@/hooks/use-theme';
import { apiClient, APIClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  LEANING_STOPS,
  describeLeaning,
  leaningDialResultSchema,
  type LeaningStop,
} from '@/lib/app/voice/leanings';
import type { LeaningDialView, LeaningsView } from '@/lib/app/voice/leanings-store';

function Panel({
  heading,
  sub,
  children,
}: {
  heading: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'bg-background rounded-lg border border-[var(--color-card-border)]',
        // The kit's resting shadow, and not decoration. `--color-card-border`
        // is FULLY transparent in light mode and 8% in dark, so without this
        // the panel's only edge in light mode was a 1.06:1 fill difference
        // against the surface while dark had a visible border — the two themes
        // separated structurally rather than chromatically, which is the whole
        // defect giving the surface its own ground set out to close. `Card`
        // escapes it by carrying this; a hand-rolled panel has to say so.
        'shadow-[var(--shadow-rest)]',
        'px-[22px] pt-5 pb-[22px]'
      )}
    >
      <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
        <h2 className="brand-display text-[22px] leading-[1.12] text-[var(--color-heading)]">
          {heading}
        </h2>
        <p className="text-muted-foreground min-w-[150px] flex-1 text-[12.5px] leading-[1.55]">
          {sub}
        </p>
      </div>
      {children}
    </section>
  );
}

/**
 * Settings: the theme, and the person's voice leanings.
 *
 * ## The leanings are live (f-leanings t-135)
 *
 * Each dial is five stops, saved the moment one is chosen, and each change is
 * a new version of the person's own setting, never an overwrite. Stops beyond
 * the bounds Lelañea Fulton sets are offered disabled, and a locked dial says
 * so. Nothing reads a leaning into a reply until t-136, so this task's read
 * surface is the dial itself: it shows what was stored (`HB9`).
 *
 * ## Why the pressed state waits for mount
 *
 * `useTheme` resolves from `localStorage` and `matchMedia`, neither of which
 * exists on the server, so its first client value and its SSR value differ by
 * design — the provider returns `light` on the server and the real answer after
 * hydration. Sunrise's `components/theme-toggle.tsx` answers this by rendering
 * markup that is theme-agnostic and letting a `dark:` variant do the work,
 * which is possible for an icon and not for `aria-pressed`: an attribute cannot
 * be set by CSS.
 *
 * So the pressed state is withheld until mounted rather than rendered wrong.
 *
 * ## Why it presses on the CHOICE and not on the resolved theme
 *
 * D4 gives the app three states — following the device, light, dark — and makes
 * the first the default. `theme` alone cannot tell "chose light" from
 * "following a device that is currently light", so pressing a chip on it would
 * report a choice nobody made: a reader on macOS auto-appearance opens this at
 * midday, sees Light marked as theirs, and finds it dark at sunset.
 *
 * `useTheme` publishes `choice` for exactly this, and `clearTheme` for the way
 * back. Both are Lelañea additions to a Sunrise file — `.context/app/
 * divergences.md` row 2 — and both were forced by this panel: t-11 first
 * reached for the stored value by reading `localStorage` here, which put this
 * file's idea of the storage key in a second place with only a test holding the
 * two together. That duplication is gone.
 *
 * ## Three chips, not two
 *
 * A two-chip control cannot express the default state, so choosing either was a
 * one-way door: nothing cleared the stored value, and following the device
 * again meant clearing site data by hand. The third chip is the whole reason
 * `clearTheme` exists.
 */
export function SettingsView({ leanings }: { leanings: LeaningsView }) {
  const { theme, choice, setTheme, clearTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <>
      <Panel
        heading="Light and dark"
        sub="Follow your device, or pick one and it stands until you say otherwise."
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Theme">
          {/*
            Three chips, because the app has three states and D4 makes the
            third the DEFAULT. Two of them could not express "following your
            device", so choosing either was a one-way door — reachable again
            only by clearing site data by hand.
          */}
          <Chip selected={mounted && choice === null} onClick={clearTheme}>
            Follow my device
          </Chip>
          {(['light', 'dark'] as const).map((value) => (
            <Chip
              key={value}
              selected={mounted && choice === value}
              onClick={() => setTheme(value)}
            >
              {value === 'light' ? 'Light' : 'Dark'}
            </Chip>
          ))}
        </div>
        {mounted && choice === null ? (
          <p className="text-muted-foreground mt-3 text-[13px] leading-[1.55]">
            Following your device, which is showing the {theme === 'dark' ? 'dark' : 'light'} theme
            just now.
          </p>
        ) : null}
      </Panel>

      <LeaningsPanel initial={leanings} />
    </>
  );
}

const LEANINGS_ROUTE = '/api/v1/app/leanings';

/** The eleven dials, each saved as it is moved. */
function LeaningsPanel({ initial }: { initial: LeaningsView }) {
  const noteId = useId();
  return (
    <Panel heading="Leanings" sub="Dials, none of them absolute.">
      <p id={noteId} className="text-muted-foreground mb-4 text-[13.5px] leading-[1.65]">
        {initial.configured
          ? 'Each one moves how the replies lean, not who is speaking. The middle is Lelañea’s own voice; your choice is saved as you make it, and you can always come back to the middle.'
          : 'These can’t be changed just now, so the replies use Lelañea’s own voice. Try again later.'}
      </p>
      <div>
        {initial.dials.map((dial) => (
          <LeaningDial key={dial.key} initial={dial} describedBy={noteId} />
        ))}
      </div>
    </Panel>
  );
}

/**
 * One dial: five native radio stops between its two poles.
 *
 * Native radios, so arrow keys move along the dial and a screen reader hears a
 * group named by both poles with each stop named for what it does. Each change
 * saves; the shown stop goes back if the save fails, with the reason beside it.
 */
function LeaningDial({ initial, describedBy }: { initial: LeaningDialView; describedBy: string }) {
  const [dial, setDial] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useId();
  const errorId = useId();

  async function choose(stop: LeaningStop) {
    const before = dial;
    setDial({ ...dial, position: stop, stored: stop });
    setSaving(true);
    setError(null);
    try {
      const raw = await apiClient.patch<unknown>(LEANINGS_ROUTE, {
        body: { key: dial.key, stop },
      });
      const parsed = leaningDialResultSchema.parse(raw);
      setDial({ ...before, ...parsed.dial });
    } catch (caught: unknown) {
      setDial(before);
      setError(
        caught instanceof APIClientError && caught.message
          ? caught.message
          : 'That didn’t save. Try again.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset
      className="border-b border-[var(--color-divider)] px-1 pt-[11px] pb-3"
      aria-describedby={error ? `${describedBy} ${errorId}` : describedBy}
      aria-busy={saving}
    >
      {/*
        Both poles are the legend, so the group's name is the span the dial
        sits between: "Gentle" alone says nothing about which way it leans.
      */}
      <legend className="text-muted-foreground mb-[7px] flex w-full justify-between gap-3 text-xs">
        <span>{dial.left}</span>
        <span className="sr-only"> to </span>
        <span>{dial.right}</span>
      </legend>
      <div className="relative flex items-center justify-between">
        <span
          aria-hidden="true"
          className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-[var(--color-divider)]"
        />
        {LEANING_STOPS.map((stop) => {
          const outside = stop < dial.min || stop > dial.max;
          const checked = dial.position === stop;
          return (
            <label key={stop} className="relative flex h-6 w-6 items-center justify-center">
              <input
                type="radio"
                name={name}
                value={stop}
                checked={checked}
                disabled={dial.locked || outside || saving}
                onChange={() => void choose(stop)}
                aria-label={describeLeaning(dial, stop)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'block rounded-full border transition-[width,height]',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--tone,var(--color-secondary))] peer-focus-visible:ring-offset-2',
                  checked
                    ? 'h-4 w-4 border-[var(--tone,var(--color-secondary))] bg-[var(--tone,var(--color-secondary))]'
                    : 'bg-background h-2.5 w-2.5 border-[var(--color-divider)]',
                  outside || dial.locked ? 'opacity-35' : 'cursor-pointer'
                )}
              />
            </label>
          );
        })}
      </div>
      {dial.locked ? (
        <p className="text-muted-foreground mt-2 text-[12.5px]">
          Lelañea keeps this one where it is.
        </p>
      ) : dial.min > -2 || dial.max < 2 ? (
        <p className="text-muted-foreground mt-2 text-[12.5px]">
          Lelañea keeps this from going all the way.
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-destructive mt-2 text-[12.5px]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
