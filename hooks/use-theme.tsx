'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  /** The theme in force — an explicit choice, or the device's preference. */
  theme: Theme;
  /**
   * The stored EXPLICIT choice, or `null` while the device is being followed.
   *
   * LELAÑEA divergence (row 2). D4 gives the app three states and the platform
   * published two: `theme` alone cannot distinguish "chose light" from
   * "following a device that is currently light". A settings page that renders
   * a choice therefore had no way to be honest, and t-11 worked around it by
   * reading `localStorage` directly — duplicating this file's key in a second
   * place, with nothing but a test holding the two together.
   *
   * `null` on the server and on the first client render, like `theme`.
   */
  choice: Theme | null;
  setTheme: (theme: Theme) => void;
  /**
   * Forget the stored choice and follow the device again.
   *
   * LELAÑEA divergence (row 2). Without it D4's default is reachable only by
   * clearing site data by hand: `setTheme` is the platform's only writer and it
   * exclusively persists.
   */
  clearTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * LELAÑEA divergence — see `.context/app/divergences.md`, row 2.
 *
 * Upstream persisted the resolved SYSTEM preference to `localStorage` on first
 * paint, so from the second visit onward "hasn't chosen yet" was stored exactly
 * like "chose light", and a later OS switch was never followed. In vanilla
 * Sunrise that is invisible — both themes are near-greyscale. On Lelañea the
 * two are oyster white and near-black charcoal, so it is the difference between
 * the app tracking your machine and ignoring it.
 *
 * Decision D4: the system preference is the DEFAULT; only the toggle persists a
 * choice. So this reads storage without writing to it, and follows the OS for
 * as long as nothing is stored. The storage key, the `<html>` class and the
 * hook's public shape are all unchanged from the platform's.
 *
 * The matching read in the no-flash script in `app/layout.tsx` had the same
 * write and lost it in the same commit; the two must agree or the first paint
 * disagrees with the first render.
 */
const STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * What this session asked for, regardless of whether storage accepted it.
 *
 * `null` defers to storage. The two named states exist because both writers
 * swallow a failure on purpose — Safari private browsing throws on `setItem`
 * and `removeItem` alike — so storage is not a reliable record of what the
 * reader just did, and the OS listener needs to know which way to fail.
 */
type SessionIntent = 'chose' | 'cleared' | null;

/** The stored EXPLICIT choice, or null when the user has not made one. */
function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    // Private-mode or blocked storage: treat it as "no choice recorded".
    return null;
  }
}

function readSystemTheme(): Theme {
  // Same defensiveness as the subscription below: without `matchMedia` this
  // runs inside a state initializer, where a throw fails the render outright.
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // What this SESSION asked for, held independently of whether either write
  // landed. `setTheme` swallows a `setItem` throw so the choice still applies
  // for the session — but the OS listener's guard reads storage back, and in
  // that exact case reads `null`. Without this ref, a Safari private window
  // (which throws on `setItem` while `getItem` works) would let the next
  // macOS sunrise auto-switch revert a deliberate toggle, with no way to make
  // it stick. Storage is still re-read on every event, so a choice made in
  // another tab is honoured too; this only ADDS a reason to stop following.
  const sessionIntent = useRef<SessionIntent>(null);
  // Matches the no-flash script's resolution exactly: an explicit choice wins,
  // otherwise the system preference. Neither writes.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    return readStoredTheme() ?? readSystemTheme();
  });

  /*
   * The same fact as `hasExplicitChoice`, as STATE rather than a ref, because
   * this one is rendered. The ref stays because the OS listener below is
   * registered once and would capture a stale value; both are written in the
   * same two places, and `clearTheme` is the only thing that sets either back.
   */
  const [choice, setChoice] = useState<Theme | null>(() => {
    if (typeof window === 'undefined') return null;
    return readStoredTheme();
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // Follow the OS while no explicit choice is stored. The guard is re-read on
  // every event rather than captured, so the listener stops taking effect the
  // moment a choice is recorded — including one made in another tab.
  //
  // NOT full cross-tab sync, and the distinction matters: a second tab STOPS
  // FOLLOWING once another tab writes a choice, but it does not adopt it, so it
  // can sit on the old theme until reload. Closing that needs a `storage`
  // listener. Left alone on purpose — upstream has the same gap, so adding one
  // would widen divergence row 2 beyond the defect daybreak#236 describes and
  // make the eventual revert less clean.
  useEffect(() => {
    // Upstream only ever reached `matchMedia` when nothing was stored. This
    // subscription runs on every mount, so it must not assume the API exists:
    // `MediaQueryList.addEventListener` is missing on Safari < 14, and throwing
    // inside an effect takes down the tree via the nearest error boundary —
    // including for users with an explicit choice, who never needed this path.
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media?.addEventListener) return;

    const onChange = (event: MediaQueryListEvent) => {
      // `null` means no intent was expressed in this session, so storage
      // decides. `'cleared'` must beat storage: `clearTheme` swallows a failed
      // `removeItem` the same way `setTheme` swallows a failed `setItem`, so
      // the stored value can still be sitting there after the reader has asked
      // to be rid of it. Re-reading storage alone left the app ignoring the
      // device while the settings panel said it was following it.
      if (sessionIntent.current === 'chose') return;

      /*
       * Storage is a THIRD source of truth here, and another tab can move it
       * under us. So whichever way this goes, `choice` is reconciled with what
       * was just read — without it, a tab whose stored choice had been cleared
       * next door went on pressing that chip in `/app/settings` while tracking
       * the device, which is the "reports a choice nobody made" failure the
       * three-chip control exists to prevent.
       */
      const stored = readStoredTheme();
      if (sessionIntent.current === null && stored !== null) {
        setChoice(stored);
        return;
      }

      setChoice(null);
      setThemeState(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // The ONLY writer. Persisting here is what makes a choice explicit.
  const setTheme = useCallback((next: Theme) => {
    // Recorded BEFORE the write, and regardless of whether it succeeds: this is
    // what makes the choice explicit for the session even when nothing persists.
    sessionIntent.current = 'chose';
    setChoice(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable — the choice still applies for this session.
    }
    setThemeState(next);
  }, []);

  /**
   * LELAÑEA divergence (row 2): the way back to D4's default.
   *
   * Symmetric with `setTheme` in the part that matters — the ref is cleared
   * BEFORE the write and regardless of whether it succeeds, so a browser that
   * refuses `removeItem` still follows the device for the rest of the session
   * rather than being stuck on a choice it cannot forget.
   *
   * Resolving the system preference here rather than leaving `theme` alone is
   * what makes the control do something visible: the reader chose "follow my
   * device" and the device may disagree with what is on screen.
   */
  const clearTheme = useCallback(() => {
    sessionIntent.current = 'cleared';
    setChoice(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
      // Downgrade to `null` once the removal is CONFIRMED, so `'cleared'` only
      // ever means "storage lied". Left latched, it outranked storage for the
      // rest of the session — so a tab that had cleared (including by clicking
      // the already-pressed chip, a no-op a reader would think nothing of)
      // would go on following the OS over an explicit choice made in another
      // tab. The pre-t-23 boolean was `false` in that state and storage won.
      if (readStoredTheme() === null) sessionIntent.current = null;
    } catch {
      // Storage unavailable — following the device still applies this session,
      // and `'cleared'` stays latched because that is exactly the case it is
      // for.
    }
    setThemeState(readSystemTheme());
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, choice, setTheme, clearTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
