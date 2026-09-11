'use client';

import { useEffect, useId, useState } from 'react';

import { Chip } from '@/components/app/ui/chip';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

/**
 * The eleven dials, in the prototype's order, each as the two ends it sits
 * between and where it currently rests.
 *
 * The resting values are the prototype's and are shown, not stored: nothing
 * reads them, so they are a picture of the shape rather than a setting anyone
 * has made. That is why every slider below is `disabled` — see the panel's own
 * note, which says so on the page rather than only here.
 */
const LEANINGS: readonly (readonly [left: string, right: string, value: number])[] = [
  ['Philosophical', 'Grounded and practical', 38],
  ['Spiritual and devotional', 'Secular and plain', 46],
  ['Gentle', 'Direct, and further, challenging', 62],
  ['Encouraging', 'Neutral and unsentimental', 50],
  ['Verbose and exploratory', 'Concise and spare', 44],
  ['Empathetic and warm', 'Cool and analytical', 30],
  ['Energetic', 'Slow and spacious', 70],
  ['Question-led', 'Guidance-led', 34],
  ['Story and metaphor', 'Literal', 42],
  ['Playful', 'Serious', 56],
  ['Formal', 'Familiar', 66],
] as const;

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
 * Settings — the one view in t-11 where a control actually does something.
 *
 * ## The theme choice is real; the leanings are not
 *
 * Nothing reads a voice leaning until a model is called, which is phase 2. A
 * slider that moved and changed nothing would teach exactly the wrong lesson
 * about which of these controls can be trusted (D6), so they render disabled
 * with the reason written beside them. `B31`'s middle option: show the shape,
 * say plainly it is not wired, invent nothing.
 *
 * ## Why the pressed state waits for mount
 *
 * `useTheme` resolves from `localStorage` and `matchMedia`, neither of which
 * exists on the server, so its first client value and its SSR value differ by
 * design — the provider returns `light` on the server and the real answer after
 * hydration. `shell-topbar.tsx` answers this by rendering markup that is
 * theme-agnostic and letting a `dark:` variant do the work, which is possible
 * for an icon and not for `aria-pressed`: an attribute cannot be set by CSS.
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
export function SettingsView() {
  const { theme, choice, setTheme, clearTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const leaningsNoteId = useId();
  // One base, indexed per row: a leaning's own words contain spaces, and an
  // `id` with a space is not a valid target for `htmlFor`.
  const leaningId = useId();

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

      <Panel heading="Her leanings" sub="Eleven dials, none of them absolute.">
        <p id={leaningsNoteId} className="text-muted-foreground mb-4 text-[13.5px] leading-[1.65]">
          These are shown but not yet settable — nothing reads them until she is answering you, so
          they arrive with the conversation. Where they rest here is the shape they take, not a
          choice anyone has made.
        </p>
        <div>
          {LEANINGS.map(([left, right, value], index) => (
            <div key={left} className="border-b border-[var(--color-divider)] px-1 pt-[11px] pb-3">
              {/*
                Both ends are inside the `<label>`, so the slider's accessible
                name is the span it sits between rather than only its left end —
                "Gentle" alone says nothing about which way the handle means.
              */}
              <label
                htmlFor={`${leaningId}-${index}`}
                className="text-muted-foreground mb-[7px] flex justify-between gap-3 text-xs"
              >
                <span>{left}</span>
                <span>{right}</span>
              </label>
              <input
                id={`${leaningId}-${index}`}
                type="range"
                min={0}
                max={100}
                defaultValue={value}
                disabled
                aria-describedby={leaningsNoteId}
                className="w-full accent-[var(--tone,var(--color-secondary))] disabled:opacity-60"
              />
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
