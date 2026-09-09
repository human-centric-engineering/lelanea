'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
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
  // A choice made in THIS session, held independently of whether the write
  // landed. `setTheme` swallows a `setItem` throw so the choice still applies
  // for the session — but the OS listener's guard reads storage back, and in
  // that exact case reads `null`. Without this ref, a Safari private window
  // (which throws on `setItem` while `getItem` works) would let the next
  // macOS sunrise auto-switch revert a deliberate toggle, with no way to make
  // it stick. Storage is still re-read on every event, so a choice made in
  // another tab is honoured too; this only ADDS a reason to stop following.
  const hasExplicitChoice = useRef(false);
  // Matches the no-flash script's resolution exactly: an explicit choice wins,
  // otherwise the system preference. Neither writes.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    return readStoredTheme() ?? readSystemTheme();
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
      if (hasExplicitChoice.current || readStoredTheme() !== null) return;
      setThemeState(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // The ONLY writer. Persisting here is what makes a choice explicit.
  const setTheme = useCallback((next: Theme) => {
    // Recorded BEFORE the write, and regardless of whether it succeeds: this is
    // what makes the choice explicit for the session even when nothing persists.
    hasExplicitChoice.current = true;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable — the choice still applies for this session.
    }
    setThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
