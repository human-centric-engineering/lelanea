'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  /** `commit: false` while a drag is in flight — see the implementation. */
  setChatWidth: (px: number, commit?: boolean) => void;
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
   * choice the reader made deliberately, and they would never get it back. So
   * the viewport may set the live value and never the stored one; only the
   * toggle writes storage. That is decision D4's ruling on the theme applied
   * unchanged, and already carried here as divergence Row 2.
   *
   * ## Why an override, rather than mirroring storage into state
   *
   * Mirroring was the first shape and it had a race that no amount of care in
   * the effects would fix: the viewport check is a LAYOUT effect and the storage
   * sync is a plain one, so on a narrow first paint the auto-slim ran and was
   * then overwritten by the stored `false` a moment later. The nav simply did
   * not slim.
   *
   * Reading `override ?? stored` removes the ordering question entirely — there
   * is one value, and it is computed rather than raced into. It also fixes the
   * reverse case for free: with the override untouched, widening past 1100 lets
   * the stored preference apply again, instead of leaving the reader slimmed for
   * the rest of the session with no way back to what they had chosen.
   */
  const [storedSlim, setStoredSlim] = useLocalStorage<boolean>(SLIM_KEY, false);
  const [slimOverride, setSlimOverride] = useState<boolean | null>(null);
  const navSlim = slimOverride ?? storedSlim;

  const [storedChatW, setStoredChatW] = useLocalStorage<number>(CHAT_W_KEY, CHAT_DEFAULT);
  const [chatW, setChatW] = useState(CHAT_DEFAULT);
  const [chatSlim, setChatSlimState] = useState(false);
  /* Same reasoning as the nav's, and clamped: a hand-edited or stale stored
     width must not put the pane outside the bounds the handle enforces. */
  useEffect(() => {
    setChatW(Math.max(CHAT_MIN, Math.min(CHAT_MAX, storedChatW)));
  }, [storedChatW]);

  /**
   * `fitToWidth()`, as an effect.
   *
   * The auto-slim fires on CROSSING 1100px, not on every resize event, and the
   * difference is the whole of it: `resize` fires continuously while a window is
   * dragged, so re-asserting the slim on each one meant that between 901 and
   * 1099 an explicit expand was undone by the very next event. The toggle
   * appeared not to work at all. Crossing is also what the rule actually means —
   * "there is no longer room for labels" is a thing that happens once.
   */
  const lastWidth = useRef<number | null>(null);
  useIsomorphicLayoutEffect(() => {
    const fit = () => {
      const w = window.innerWidth;
      const previous = lastWidth.current;
      lastWidth.current = w;

      const next = classify(w);
      setWidth(next);

      if (next === 'small') {
        // No sliver on a phone — the pane switch does that job.
        setChatSlimState(false);
        // `previous` is cleared so that widening OUT of small counts as a fresh
        // approach to 1100. Otherwise 800 → 1000 saw `previous = 800`, found no
        // inward crossing, and left the nav expanded at a width where a direct
        // load at 1000 slims it — a rotation and a reload disagreeing.
        lastWidth.current = null;
        return;
      }

      // The drawer belongs to small screens; leaving it open on the way up
      // strands a fixed panel over a layout that has no scrim any more.
      setNavOpenState(false);

      const crossedInward = w < 1100 && (previous === null || previous >= 1100);
      if (crossedInward) setSlimOverride(true);
      // Crossing back out drops the override, so the reader's stored preference
      // applies again rather than being buried for the session.
      if (w >= 1100 && previous !== null && previous < 1100) setSlimOverride(null);
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

  /**
   * With no workspace there is no second pane to be showing — AND nothing for
   * the conversation to be folded against.
   *
   * Resetting only `pane` left `chatSlim` set, so "Return to the conversation"
   * on a tablet produced a screen with no conversation on it: the workspace
   * unmounts, the panel stops being an overlay, and the pane takes its folded
   * early return — a 56px strip beside empty space. The fold means "give the
   * width to the work"; with no work there is nothing to give it to.
   */
  useEffect(() => {
    if (!wsOpen) {
      setPaneState('chat');
      setChatSlimState(false);
      return;
    }
    // And the other direction: asking for a module should SHOW it. On a phone
    // the panes are a carousel, so opening one while `pane` was still `'chat'`
    // rendered the thing the reader had just tapped off-screen and `inert` —
    // they had to swipe or use the switch to reach what they had asked for.
    setPaneState('ws');
  }, [wsOpen]);

  /**
   * Below 900px the nav is a drawer over the content, so following a link inside
   * it has to close it. Nothing else does: the scrim, Escape, the burger and a
   * resize upward all clear it, but a route change left the drawer and its scrim
   * sitting over the page the reader had just asked for.
   */
  useEffect(() => {
    setNavOpenState(false);
  }, [pathname]);

  /**
   * `commit` separates "show me this width" from "remember this width".
   *
   * A drag calls this on every `pointermove`, and persisting there meant a
   * synchronous `JSON.stringify` + `setItem` + `dispatchEvent` — plus the
   * same-tab listener's own `setState` — on the main thread every frame, for the
   * whole drag. Only the value the reader settles on is worth storing, so the
   * pointer path commits on `pointerup` and the keyboard path commits per press
   * (where each press already IS a settled value).
   */
  const setChatWidth = useCallback(
    (px: number, commit = true) => {
      // Dragging it narrow enough is a way of asking for it gone.
      if (px < CHAT_FOLD) {
        setChatSlimState(true);
        return;
      }
      setChatSlimState(false);
      const clamped = Math.max(CHAT_MIN, Math.min(CHAT_MAX, px));
      setChatW(clamped);
      if (commit) setStoredChatW(clamped);
    },
    [setStoredChatW]
  );

  const setChatSlim = useCallback((slim: boolean) => setChatSlimState(slim), []);
  const setNavOpen = useCallback((open: boolean) => setNavOpenState(open), []);
  const openDrawer = useCallback((id: DrawerId) => setDrawer(id), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const setPane = useCallback((p: Pane) => setPaneState(p), []);

  const toggleNavSlim = useCallback(() => {
    const next = !navSlim;
    setSlimOverride(next);
    setStoredSlim(next); // the ONLY write to storage
  }, [navSlim, setStoredSlim]);

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
