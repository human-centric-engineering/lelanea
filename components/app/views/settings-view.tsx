'use client';

import { useEffect, useId, useRef, useState } from 'react';

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

const THEME_STORAGE_KEY = 'theme';

/** The stored EXPLICIT choice, or `null` when the reader has not made one. */
function readStoredChoice(): 'light' | 'dark' | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    // Blocked or private-mode storage reads as "no choice recorded", which is
    // the same answer the hook gives itself in that case.
    return null;
  }
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
 * ## Why it presses on the STORED choice and not on the resolved theme
 *
 * D4 says the system preference is the default and only the toggle persists, so
 * the app has three states and `useTheme` publishes two: it returns the
 * RESOLVED theme and deliberately keeps "nothing chosen" out of its shape (see
 * `.context/app/divergences.md` row 2, which pins that shape as untouched).
 *
 * Pressing a chip on the resolved value therefore reports a choice nobody made.
 * A reader on macOS auto-appearance would open this at midday, see Light marked
 * as theirs, and find it dark at sunset — with the panel one line above saying
 * their choice stands. So the view reads the stored value itself, and presses
 * nothing until there is one.
 *
 * The key is written out here rather than imported because the hook keeps it
 * private and row 2 is explicit that its public shape does not change. What
 * stops the two drifting is not this comment but a test that clicks, unmounts
 * and remounts: if the hook ever wrote somewhere this does not read, the chip
 * comes back unpressed and that test fails.
 *
 * What is still missing is the way BACK — nothing here clears the stored value,
 * so following the device again is a reload-and-clear-storage job. That needs a
 * writer `useTheme` does not expose, which is a change to a Sunrise file this
 * repo already diverges on, so it is carried as a deferral rather than taken
 * here.
 */
export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [chosen, setChosen] = useState<'light' | 'dark' | null>(null);
  /*
   * A choice made HERE, held independently of whether the write landed — the
   * same guard, and for the same reason, as the provider's own
   * `hasExplicitChoice`. `setTheme` deliberately swallows a `setItem` throw so
   * the choice still applies for the session; without this ref, re-reading
   * storage after that would find nothing and un-press the chip one frame after
   * the click, restoring "Nothing chosen yet" on an app that is explicitly dark
   * for the session. Storage still WINS when it has a value, which is what lets
   * the topbar's toggle move the pressed chip.
   */
  const choseHere = useRef<'light' | 'dark' | null>(null);
  const leaningsNoteId = useId();
  // One base, indexed per row: a leaning's own words contain spaces, and an
  // `id` with a space is not a valid target for `htmlFor`.
  const leaningId = useId();

  /*
   * Keyed on `theme`, NOT on mount.
   *
   * This view is not the only writer. `ShellTopbar` renders a live sun/moon
   * toggle in the same frame, above `Panes`, and it calls the same `setTheme`.
   * A one-shot read on mount meant clicking it left this panel asserting the
   * opposite of what the app was doing — "Nothing chosen yet" still on screen
   * after a choice had just been stored, or "Light" still pressed on a dark
   * app. Round one moved the source of truth to storage and left it stale;
   * re-reading whenever the resolved theme changes is what closes it, because
   * the toggle always flips the theme it writes.
   */
  useEffect(() => {
    setMounted(true);
    setChosen(readStoredChoice() ?? choseHere.current);
  }, [theme]);

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
              selected={mounted && chosen === value}
              onClick={() => {
                choseHere.current = value;
                setTheme(value);
                setChosen(value);
              }}
            >
              {value === 'light' ? 'Light' : 'Dark'}
            </Chip>
          ))}
        </div>
        {mounted && chosen === null ? (
          <p className="text-muted-foreground mt-3 text-[13px] leading-[1.55]">
            Nothing chosen yet — following your device, which is showing the{' '}
            {theme === 'dark' ? 'dark' : 'light'} theme just now.
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
