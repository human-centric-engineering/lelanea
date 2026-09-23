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

import { modulePath } from '@/lib/app/journey/paths';
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

/**
 * The attribute the ≤900px burger carries, so that closing the drawer can hand
 * focus back to it.
 *
 * A data attribute rather than a ref through context: the burger lives in
 * `shell-topbar.tsx`, the drawer closes from four places in three files, and
 * threading a ref between two sibling islands to answer "where did this come
 * from" is more machinery than one selector.
 */
export const NAV_TOGGLE_ATTR = 'data-nav-toggle';

/**
 * Marks a full-screen overlay that covers the shell, so shell-wide `document`
 * listeners stand down while it is up.
 *
 * `pointer-events` cannot express this. It decides what a press reaches by
 * HIT-TESTING, and a listener bound to `document` is not under the overlay —
 * it sees the press either way. The entry bloom found this the hard way: it is
 * deliberately solid to the pointer for its ~2.9s so a click cannot reach a nav
 * item nobody can see, and the nav's click-away collapsed the menu anyway,
 * because the overlay is neither a control nor inside the nav.
 *
 * An attribute rather than a list of component names, so the next full-screen
 * thing opts out by carrying it rather than by being remembered.
 *
 * **It is detected by hit-testing (`closest`), so it covers exactly the window
 * in which the overlay is solid to the pointer — no more.** The bloom releases
 * `pointer-events` for its 420ms fade on purpose, so that the shell is live as
 * it appears rather than half a second later; through that slice a press lands
 * on the shell, `event.target` is whatever is underneath, and this guard
 * correctly does not fire. That is the same boundary in both directions rather
 * than a hole in one of them: while the overlay is blocking the pointer, nothing
 * beneath it reacts; once it has stopped, everything does. Gating on the bloom's
 * animation phase instead would mean the shell looked live and was not.
 */
export const SHELL_OVERLAY_ATTR = 'data-shell-overlay';

/**
 * The width below which the nav slims itself, whatever the reader prefers.
 *
 * Named because TWO things ask it now: `fit`, on crossing it inward, and
 * `setChatSlim`, when it hands the override back — a release that ignored the
 * viewport put a 234px menu on a 1000px tablet. A threshold written twice is a
 * threshold that gets changed once.
 */
export const AUTO_SLIM_BELOW = 1100;

/** The prototype's `RZ.chat` bounds and `CHAT_FOLD`. */
export const CHAT_MIN = 330;
export const CHAT_MAX = 660;
export const CHAT_DEFAULT = 440;
export const CHAT_FOLD = 296;

/** `fitToWidth()`'s three classes, named rather than recomputed at each site. */
export type WidthClass = 'small' | 'medium' | 'large';
export type DrawerId = 'map' | 'resources';
export type Pane = 'chat' | 'ws';

/**
 * Where the reader is, as the module page tells the shell.
 *
 * The slug is carried alongside the label so a reader is never shown the
 * previous module's name for a frame: the label is used only while the slug
 * still matches the route, so a navigation that outruns the publishing effect
 * shows nothing rather than something wrong.
 */
export interface ModulePlace {
  slug: string;
  /** `01 · Values` — the authored display number and title. */
  label: string;
}

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
  /**
   * A resource — a film or a reading — the resources drawer was asked to put
   * first: `openDrawer('resources', { pin })`, and `null` for a plain open. The
   * drawer sends it to the API as `?pin=`; nothing else reads it. Cleared on
   * close and on navigation, so the next open is a plain one and a pin never
   * outlives the route it was made on. This is the whole of what a suggestion
   * made in conversation needs from the shell (t-77): one field, not a
   * resources-specific API.
   */
  drawerPin: string | null;
  pane: Pane;
  /**
   * The module the workspace is showing, published UP from the page — see
   * `setModulePlace`. `null` anywhere that is not a module.
   */
  modulePlace: ModulePlace | null;
  /**
   * How a module page tells the shell what it is.
   *
   * The conversation column's way back reads `← the main conversation · on 01 ·
   * Values`, and the shell cannot work that second half out for itself: a module
   * page is rendered INSIDE the workspace, which is a sibling of the
   * conversation, and context flows downward only. The page is also the only
   * thing holding the authored display number and title — the shell has a
   * pathname and nothing else.
   *
   * `shell.md` already ruled that a view's title is not worth carrying up here
   * for the workspace's own header, because a context set from an effect costs a
   * frame of empty heading on every navigation. This is a different bargain and
   * the ruling still holds: what is missing for that frame is a muted suffix
   * beside a link that is already correct and already says where it goes, not
   * the heading of the page.
   */
  setModulePlace: (place: ModulePlace | null) => void;
  /**
   * How many turns have finished having written to her notes, this session.
   *
   * A **counter, not a timestamp and not a boolean.** The panel refreshes on
   * every change, so the value only has to differ from the last one it saw: a
   * boolean has nowhere to go after the first turn, and a clock makes a refresh
   * depend on two turns landing in different milliseconds. It starts at 0 and
   * the panel's first read is its mount, so a mount is never a refresh.
   *
   * It lives here for the `modulePlace` reason: the conversation and the
   * workspace are SIBLINGS, and a turn ends in the first while the notes are
   * rendered in the second. See `noteSlotsWritten`.
   */
  slotsWritten: number;
  /**
   * A turn ended having written at least one note. Called once per turn by
   * `useConversation`, never per `fill_slot` frame — a turn that writes three
   * notes is still one refresh, and the read is the whole page either way.
   */
  noteSlotsWritten: () => void;
  /**
   * How many turns have finished, this session, whatever they did.
   *
   * `slotsWritten`'s shape and its reason for living here: a counter the
   * topbar's spend meter compares against the value it saw last, because the
   * conversation that spends and the bar that shows it are siblings (t-95).
   * Kept apart from `slotsWritten` because that one counts only turns that
   * wrote a note, and a turn that wrote nothing still cost something.
   */
  turnsSettled: number;
  /**
   * A turn is over — answered, ended, or refused. Called once per turn by
   * `useConversation`, never per streamed frame, so what reads it re-reads at
   * most as often as a person sends.
   */
  noteTurnSettled: () => void;
  /**
   * Words the composer should be holding, put there by something outside the
   * conversation — today, "Ask her about this" on a note. `null` when there is
   * nothing waiting, which is almost always.
   *
   * The conversation takes them by calling {@link takeAsk}, and the taking is
   * what makes the same words handable twice: `null` in between means the next
   * hand-over is a change even when the text is identical. Without it, asking
   * about the same note a second time would set state to the value it already
   * held and no effect would run.
   */
  ask: string | null;
  /** Hand words to the composer. Replaces anything not yet taken. */
  setAsk: (text: string) => void;
  /** The composer has the words. Clears {@link ask}. */
  takeAsk: () => void;
  toggleNavSlim: () => void;
  /**
   * Collapse the menu to the icon rail WITHOUT touching the stored preference —
   * the click-away in `shell-nav.tsx`. See the implementation for why the two
   * are different acts.
   */
  collapseNav: () => void;
  setNavOpen: (open: boolean) => void;
  /** Close the ≤900px drawer regardless of whether the route changed. */
  closeNav: () => void;
  /** `commit: false` while a drag is in flight — see the implementation. */
  setChatWidth: (px: number, commit?: boolean) => void;
  setChatSlim: (slim: boolean) => void;
  openDrawer: (id: DrawerId, options?: { pin?: string }) => void;
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
  const [drawerPin, setDrawerPin] = useState<string | null>(null);
  const [pane, setPaneState] = useState<Pane>('chat');
  const [modulePlaceState, setModulePlaceState] = useState<ModulePlace | null>(null);
  const [slotsWritten, setSlotsWritten] = useState(0);
  const [turnsSettled, setTurnsSettled] = useState(0);
  const [ask, setAskState] = useState<string | null>(null);

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

  /**
   * Adopt the stored preference BEFORE PAINT, and this is what pays for the
   * collapse animation being unconditional.
   *
   * `useLocalStorage` cannot help here, and for a good reason of its own: it
   * must return `initial` on the first client render or the tree does not match
   * the server's HTML, so it adopts the real value in a plain effect — after
   * paint. A reader who had chosen the slim menu therefore watched it render at
   * 234px and then correct to 64px on every single page load.
   *
   * While the width transition was armed only after a reader had used the
   * control (`shell-nav.tsx`'s old `readerToggled`), that correction was
   * invisible — but so was the first collapse, and so was every auto-slim. The
   * flag was buying the wrong thing: what actually has to be true is that the
   * startup correction never reaches the screen, and then the transition can
   * simply always be on.
   *
   * A LAYOUT effect gets that: it runs after hydration has matched the server,
   * and before the browser paints, so there is no previous frame at 234px for
   * CSS to animate away from. It is the same argument `fit` below already makes
   * for the viewport, which is why the two sit together — and why this one is
   * declared FIRST. `fit`'s auto-slim must win over a stored preference when the
   * window is under 1100px, and effects run in declaration order.
   *
   * `slimOverride` rather than a write back through `setStoredSlim`: writing
   * would be a second source of truth for a value storage already holds, and the
   * override is released on the way back out past 1100px, which drops cleanly
   * back to the same stored value once `useLocalStorage` has caught up.
   */
  useIsomorphicLayoutEffect(() => {
    try {
      const raw = window.localStorage.getItem(SLIM_KEY);
      if (raw !== null) setSlimOverride(JSON.parse(raw) === true);
    } catch {
      // Storage can be unavailable (private mode, a blocked third-party frame)
      // or hold something another process wrote. Either way the expanded
      // default stands, which is what `useLocalStorage` falls back to as well.
    }
  }, []);

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
      //
      // The raw setter here, deliberately, where every other close path uses
      // `closeNav`: this one is a WIDTH transition, so the panel stops being
      // `inert` (that is `width === 'small' && !navOpen`) and stops being a
      // panel at all — nothing is stranded, and the burger `closeNav` would
      // hand focus to no longer renders. Using `closeNav` would also capture a
      // stale `navOpen` in this mount-only effect.
      setNavOpenState(false);

      const crossedInward =
        w < AUTO_SLIM_BELOW && (previous === null || previous >= AUTO_SLIM_BELOW);
      if (crossedInward) setSlimOverride(true);
      // Crossing back out drops the override, so the reader's stored preference
      // applies again rather than being buried for the session.
      if (w >= AUTO_SLIM_BELOW && previous !== null && previous < AUTO_SLIM_BELOW) {
        setSlimOverride(null);
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
    // Keyed on `pathname`, NOT on `wsOpen`. `wsOpen` is a boolean derived from
    // the route, so it does not change between two module routes — and a phone
    // reader who had swiped the conversation in, then tapped a different module
    // from the drawer, got that module rendered off-screen and inert. Same
    // defect as arriving with `pane` on 'chat', one navigation later.
    // And the other direction: asking for a module should SHOW it. On a phone
    // the panes are a carousel, so opening one while `pane` was still `'chat'`
    // rendered the thing the reader had just tapped off-screen and `inert` —
    // they had to swipe or use the switch to reach what they had asked for.
    setPaneState('ws');
  }, [wsOpen, pathname]);

  /**
   * Below 900px the nav is a drawer over the content, so following a link inside
   * it has to close it. Nothing else does: the scrim, Escape, the burger and a
   * resize upward all clear it, but a route change left the drawer and its scrim
   * sitting over the page the reader had just asked for.
   */
  useEffect(() => {
    setNavOpenState(false);
    // A pin is for the place the suggestion was made. Carried across a
    // navigation with the drawer open, it led the NEXT module's list with a
    // film chosen for the last one (`/code-review` round 2).
    setDrawerPin(null);
  }, [pathname]);
  // `pathname` covers a navigation, and nothing else does: tapping the item for
  // the route already showing produces no change, so the drawer and its scrim
  // stayed over the page. `closeNav` is what the nav items call directly.

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

  /**
   * Ask Lelañea and the left menu are mutually exclusive — **where they are
   * actually competing** — and the rule lives HERE rather than in the two
   * components.
   *
   * ## The width condition is the rule, not a caveat on it
   *
   * The owner's reason was that the two crowd the conversation off the screen,
   * and that is a statement about one geometry: at `medium` with the workspace
   * open, the conversation is a fixed 420px panel riding OVER the work while the
   * menu is a 234px column in the flow, so the two eat the same screen from the
   * same end and a tablet shows slivers of three things and the whole of none.
   *
   * At `large` both panes are in the flow and the reader sizes the conversation
   * themselves with the handle; at `small` the menu is a drawer and the panes
   * are a carousel. Neither competes. Applied unconditionally, this folded the
   * conversation to a 56px strip when somebody expanded the menu on a 1600px
   * screen — where a 234px menu and a 440px pane fit with room to spare, so the
   * conversation vanishing reads as a bug rather than as a layout being
   * considerate. Read the reasoning attached to the rule, not just the rule.
   *
   * One copy of it, because two components each reaching for the other's setter
   * is the same rule written twice and the second copy is the one that rots.
   *
   * ## It moves the live value, and hands it back to whoever held it
   *
   * Never storage: asking for the conversation is not a statement about how you
   * like your menu. And parking the conversation RELEASES the override rather
   * than leaving it set, so the menu comes back the moment the competition ends.
   * Without that release the only thing that ever cleared it was `fit`'s
   * outward 1100px crossing — which at a fixed window width never happens, so a
   * reader who opened the conversation once kept a collapsed menu for the rest
   * of the session, which is the failure the override exists to prevent.
   *
   * **It releases to the VIEWPORT's answer, not to `null`.** `slimOverride` is
   * one slot with two writers, and dropping it to `null` handed the menu back to
   * the stored preference even when `fit` had been the one holding it. Measured:
   * a 1000px tablet with the menu expanded in storage loads slim (auto-slim,
   * below 1100), and parking the conversation put a 234px menu back on a 1000px
   * screen — the exact state the auto-slim exists to prevent, with no crossing
   * left to re-assert it. So the release asks the same question `fit` asks.
   */
  const setChatSlim = useCallback(
    (slim: boolean) => {
      setChatSlimState(slim);
      if (width !== 'medium' || !wsOpen) return;
      setSlimOverride(slim ? (window.innerWidth < AUTO_SLIM_BELOW ? true : null) : true);
    },
    [width, wsOpen]
  );

  const setNavOpen = useCallback((open: boolean) => setNavOpenState(open), []);

  /**
   * Closing the ≤900px drawer, and handing focus back.
   *
   * The panel goes `inert` the moment this runs, so a keyboard reader whose
   * focus was inside it — on a nav item, or on the close control they just
   * pressed — is left focused on an element the browser has removed from the tab
   * order. The next Tab starts again from the top of the document, which is the
   * quiet way a menu becomes unusable without a pointer.
   *
   * Focus goes to the burger, because that is the control that opened it and the
   * one that will open it again. Above 900px there is no burger and no drawer,
   * so the lookup simply finds nothing.
   */
  const closeNav = useCallback(() => {
    // Read `navOpen` rather than deciding inside a functional update: an updater
    // has to be pure, and React calls it twice in development StrictMode.
    if (navOpen) document.querySelector<HTMLElement>(`[${NAV_TOGGLE_ATTR}]`)?.focus();
    setNavOpenState(false);
  }, [navOpen]);

  const openDrawer = useCallback((id: DrawerId, options?: { pin?: string }) => {
    setDrawer(id);
    setDrawerPin(id === 'resources' ? (options?.pin ?? null) : null);
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawer(null);
    setDrawerPin(null);
  }, []);
  const setPane = useCallback((p: Pane) => setPaneState(p), []);
  const setModulePlace = useCallback((place: ModulePlace | null) => setModulePlaceState(place), []);

  /*
   * Both of these are notifications between the two panes, not layout — which
   * is the one thing this provider's docblock says does not belong here. They
   * are here for `modulePlace`'s reason rather than in spite of it: the panes
   * are siblings, context flows downward only, and this is their nearest common
   * ancestor. A module-scoped context would be a second provider wrapping the
   * same two children.
   *
   * `setSlotsWritten` takes the updater form so two turns finishing inside one
   * React batch — a retry landing beside the turn it replaced — still count as
   * two, and so the callback never has to depend on the count it increments.
   */
  const noteSlotsWritten = useCallback(() => setSlotsWritten((count) => count + 1), []);
  const noteTurnSettled = useCallback(() => setTurnsSettled((count) => count + 1), []);
  const setAsk = useCallback((text: string) => setAskState(text), []);
  const takeAsk = useCallback(() => setAskState(null), []);

  /*
   * Only while the slug still matches the route.
   *
   * The page publishes from an effect, so between asking for a module and that
   * effect running the value here is the PREVIOUS module's. Showing it would be
   * worse than showing nothing — the reader is told, confidently, that they are
   * somewhere they have just left. Comparing against the route makes the stale
   * frame empty instead of wrong.
   */
  const modulePlace =
    modulePlaceState && pathname === modulePath(modulePlaceState.slug) ? modulePlaceState : null;

  const toggleNavSlim = useCallback(() => {
    const next = !navSlim;
    setSlimOverride(next);
    setStoredSlim(next); // the ONLY write to storage
    // The other half of the rule above, and under the same condition: expanding
    // the menu parks the conversation only at `medium` with the workspace open,
    // which is the one geometry where the two compete. See `setChatSlim`.
    if (!next && wsOpen && width === 'medium') setChatSlimState(true);
  }, [navSlim, setStoredSlim, wsOpen, width]);

  /**
   * The click-away collapse. It moves the LIVE value and leaves storage alone.
   *
   * The stored preference is a deliberate choice the reader made with the
   * control; a click that happened to land on the background is not. Persisting
   * here would mean a stray press in the conversation silently rewrote a setting
   * they would then have to find and set again — the same failure `fit`'s
   * auto-slim is written to avoid, and recorded as divergence Row 2.
   */
  const collapseNav = useCallback(() => setSlimOverride(true), []);

  /**
   * The Escape chain, in the prototype's order, minus the two rungs that are not
   * ours: the entry bloom dismisses itself on a timer and has no dismiss
   * gesture, and there is no lightbox in the app shell.
   *
   * The order is the point — each rung is "the most recently opened thing that
   * is covering something" — so it is expressed as a single ordered walk rather
   * than as independent handlers, which would race.
   *
   * **Every rung goes through the verb, not the setter beneath it.** Both verbs
   * grew a second half in this branch — `closeNav` hands focus back to the
   * burger, `setChatSlim` releases the menu override — and a rung calling
   * `setNavOpenState` or `setChatSlimState` directly gets the first half only.
   * That is worse than never having added them: the same user-visible action
   * then behaves one way from the button and another from the key. Escape is
   * also the rung that can least afford it, being the keyboard-only gesture.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (navOpen) return closeNav();
      if (drawer) return closeDrawer();
      if (width === 'medium' && wsOpen && !chatSlim) return setChatSlim(true);
      if (chatSlim && width !== 'medium') return setChatSlim(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen, drawer, width, wsOpen, chatSlim, closeNav, closeDrawer, setChatSlim]);

  const value = useMemo<ShellLayout>(
    () => ({
      width,
      wsOpen,
      navSlim,
      navOpen,
      chatW,
      chatSlim,
      drawer,
      drawerPin,
      pane,
      modulePlace,
      setModulePlace,
      slotsWritten,
      noteSlotsWritten,
      turnsSettled,
      noteTurnSettled,
      ask,
      setAsk,
      takeAsk,
      toggleNavSlim,
      collapseNav,
      setNavOpen,
      closeNav,
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
      drawerPin,
      pane,
      modulePlace,
      setModulePlace,
      slotsWritten,
      noteSlotsWritten,
      turnsSettled,
      noteTurnSettled,
      ask,
      setAsk,
      takeAsk,
      toggleNavSlim,
      collapseNav,
      setNavOpen,
      closeNav,
      setChatWidth,
      setChatSlim,
      openDrawer,
      closeDrawer,
      setPane,
    ]
  );

  return <ShellLayoutContext.Provider value={value}>{children}</ShellLayoutContext.Provider>;
}
