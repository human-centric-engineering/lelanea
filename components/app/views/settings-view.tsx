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
 * Between the server's paint and hydration neither chip reads as chosen, which
 * is the honest state for a control whose answer is not knowable yet — and it
 * matches D4, where "nothing chosen" really is a state the app can be in.
 */
export function SettingsView() {
  const { theme, setTheme } = useTheme();
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
        sub="She follows your device until you choose here; after that, your choice stands."
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Theme">
          {(['light', 'dark'] as const).map((value) => (
            <Chip
              key={value}
              selected={mounted && theme === value}
              // Reading `theme` in a HANDLER is safe — it runs after hydration,
              // when the value is the real one. Only the markup has to wait.
              onClick={() => setTheme(value)}
            >
              {value === 'light' ? 'Light' : 'Dark'}
            </Chip>
          ))}
        </div>
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
