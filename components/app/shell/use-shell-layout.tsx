'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import { useLocalStorage } from '@/lib/hooks/use-local-storage';

/**
 * Before-paint on the client, nothing on the server.
 *
 * The provider needs before-paint timing so a phone never shows one frame of the
 * desktop frame before collapsing to the carousel — and React logs on a
 * `useLayoutEffect` during SSR, where there is no layout to affect. Resolved
 * ONCE at module scope, so the hook order can never change between renders.
 * Same construction as `components/surface-sync.tsx`, for the same reason.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Per-browser, not per-account: both of these are device habits. */
const SLIM_KEY = 'lelanea.nav.slim';
const CHAT_W_KEY = 'lelanea.chat.width';

/** The prototype's `RZ.chat` bounds and `CHAT_FOLD`. */
export const CHAT_MIN = 330;
export const CHAT_MAX = 660;
export const CHAT_DEFAULT = 440;
export const CHAT_FOLD = 296;

/** `fitToWidth()`'s three classes, named rather than recomputed at each site. */
export type WidthClass = 'small' | 'medium' | 'large';
export type DrawerId = 'map' | 'resources';
export type Pane = 'chat' | 'ws';

export interface ShellLayout {
  width: WidthClass;
  /** The workspace is open. Route-driven: `/app` is the clean view, anything deeper is a module. */
  wsOpen: boolean;
  navSlim: boolean;
  /** The ≤900px nav drawer. Meaningless above it, and forced shut on the way up. */
  navOpen: boolean;
  chatW: number;
  chatSlim: boolean;
  drawer: DrawerId | null;
  pane: Pane;
  toggleNavSlim: () => void;
  setNavOpen: (open: boolean) => void;
  setChatWidth: (px: number) => void;
  setChatSlim: (slim: boolean) => void;
  openDrawer: (id: DrawerId) => void;
  closeDrawer: () => void;
  setPane: (pane: Pane) => void;
}

const ShellLayoutContext = createContext<ShellLayout | null>(null);

export function useShellLayout(): ShellLayout {
  const value = useContext(ShellLayoutContext);
  if (!value) throw new Error('useShellLayout must be used within <ShellLayoutProvider>');
  return value;
}

function classify(w: number): WidthClass {
  if (w <= 900) return 'small';
  return w <= 1240 ? 'medium' : 'large';
}

/**
 * Every piece of shell state, in one place, because the prototype keeps it in one
 * place and the pieces genuinely do talk to each other.
 *
 * The prototype has a global `S` and paints classes onto `#app`; four separate
 * React islands cannot each own a slice of that, because `fitToWidth()` reaches
 * across all of them at once — a resize past 1100 slims the nav, a resize into
 * medium with the workspace open parks the conversation, and a resize down to
 * small has to shut a nav drawer that only exists below it. Splitting the state
 * per component would mean each one re-deriving the viewport and disagreeing
 * about it.
 *
 * ## The server render
 *
 * There is no viewport on the server, so the first render is `large` with the
 * nav expanded and the chat at its default — the same "resting state is the
 * default" reasoning `Lotus` uses. The real class is adopted in a layout effect
 * before paint (see below), so the correction never reaches the screen.
 */
export function ShellLayoutProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wsOpen = pathname !== '/app';

  const [width, setWidth] = useState<WidthClass>('large');
  const [navOpen, setNavOpenState] = useState(false);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [pane, setPaneState] = useState<Pane>('chat');

  /**
   * The stored preference and the live value are DIFFERENT THINGS, and keeping
   * them apart is the whole of this block.
   *
   * `fitToWidth()` slims the nav below 1100px. If that write persisted, resizing
   * a window — or opening the app on a laptop once — would silently rewrite a
   * choice the reader made deliberately, and they would never get it back.
   *
   * So: the viewport may set the live value and never the stored one; only the
   * toggle writes storage. This is decision D4's ruling on the theme applied
   * unchanged — the system preference is a default, an explicit choice is a
   * choice — and it is already carried in this repo as divergence Row 2.
   */
  const [storedSlim, setStoredSlim] = useLocalStorage<boolean>(SLIM_KEY, false);
  const [navSlim, setNavSlim] = useState(false);
  /*
   * Follow the stored value whenever it CHANGES, with no once-only guard.
   *
   * A guard was the first instinct and it was wrong: `useLocalStorage` returns
   * its initial on the first render and adopts the stored value in its own
   * effect, so a mount-only adopt reads `false` before storage has been touched
   * and then refuses to look again. The preference was never applied at all —
   * caught by the test that sets it and waits for the width.
   *
   * Following changes instead is also the behaviour we want at the edges: the
   * viewport slimming does not write storage, so it cannot trigger this, and a
   * toggle writes a genuinely different value, so it does.
   */
  useEffect(() => {
    setNavSlim(storedSlim);
  }, [storedSlim]);

  const [storedChatW, setStoredChatW] = useLocalStorage<number>(CHAT_W_KEY, CHAT_DEFAULT);
  const [chatW, setChatW] = useState(CHAT_DEFAULT);
  const [chatSlim, setChatSlimState] = useState(false);
  /* Same reasoning as the nav's, and clamped: a hand-edited or stale stored
     width must not put the pane outside the bounds the handle enforces. */
  useEffect(() => {
    setChatW(Math.max(CHAT_MIN, Math.min(CHAT_MAX, storedChatW)));
  }, [storedChatW]);

  /** `fitToWidth()`, as an effect. */
  useIsomorphicLayoutEffect(() => {
    const fit = () => {
      const w = window.innerWidth;
      const next = classify(w);
      setWidth(next);

      if (next === 'small') {
        // No sliver on a phone — the pane switch does that job.
        setChatSlimState(false);
      } else {
        // The drawer belongs to small screens; leaving it open on the way up
        // strands a fixed panel over a layout that has no scrim any more.
        setNavOpenState(false);
        if (w < 1100) setNavSlim(true);
      }
    };

    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  /**
   * Medium parks the conversation when the workspace is open.
   *
   * Separate from `fit` because it also has to fire when the WORKSPACE opens at
   * a width that has not changed — which, now that `wsOpen` is route-driven, is
   * the common case rather than the rare one.
   */
  useEffect(() => {
    if (width === 'medium' && wsOpen) setChatSlimState(true);
  }, [width, wsOpen]);

  /** With no workspace there is no second pane to be showing. */
  useEffect(() => {
    if (!wsOpen) setPaneState('chat');
  }, [wsOpen]);

  const setChatWidth = useCallback(
    (px: number) => {
      // Dragging it narrow enough is a way of asking for it gone.
      if (px < CHAT_FOLD) {
        setChatSlimState(true);
        return;
      }
      setChatSlimState(false);
      const clamped = Math.max(CHAT_MIN, Math.min(CHAT_MAX, px));
      setChatW(clamped);
      setStoredChatW(clamped);
    },
    [setStoredChatW]
  );

  const setChatSlim = useCallback((slim: boolean) => setChatSlimState(slim), []);
  const setNavOpen = useCallback((open: boolean) => setNavOpenState(open), []);
  const openDrawer = useCallback((id: DrawerId) => setDrawer(id), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const setPane = useCallback((p: Pane) => setPaneState(p), []);

  const toggleNavSlim = useCallback(() => {
    setNavSlim((current) => {
      const next = !current;
      setStoredSlim(next); // the ONLY write to storage
      return next;
    });
  }, [setStoredSlim]);

  /**
   * The Escape chain, in the prototype's order, minus the two rungs that are not
   * ours: the entry bloom dismisses itself on a timer and has no dismiss
   * gesture, and there is no lightbox in the app shell.
   *
   * The order is the point — each rung is "the most recently opened thing that
   * is covering something" — so it is expressed as a single ordered walk rather
   * than as independent handlers, which would race.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (navOpen) return setNavOpenState(false);
      if (drawer) return setDrawer(null);
      if (width === 'medium' && wsOpen && !chatSlim) return setChatSlimState(true);
      if (chatSlim && width !== 'medium') return setChatSlimState(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen, drawer, width, wsOpen, chatSlim]);

  const value = useMemo<ShellLayout>(
    () => ({
      width,
      wsOpen,
      navSlim,
      navOpen,
      chatW,
      chatSlim,
      drawer,
      pane,
      toggleNavSlim,
      setNavOpen,
      setChatWidth,
      setChatSlim,
      openDrawer,
      closeDrawer,
      setPane,
    }),
    [
      width,
      wsOpen,
      navSlim,
      navOpen,
      chatW,
      chatSlim,
      drawer,
      pane,
      toggleNavSlim,
      setNavOpen,
      setChatWidth,
      setChatSlim,
      openDrawer,
      closeDrawer,
      setPane,
    ]
  );

  return <ShellLayoutContext.Provider value={value}>{children}</ShellLayoutContext.Provider>;
}
