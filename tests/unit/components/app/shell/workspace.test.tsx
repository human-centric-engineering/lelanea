// @vitest-environment happy-dom

/**
 * The workspace surface — the frame t-11's views arrive inside.
 *
 * Two things here are structural rather than cosmetic, and both would be easy to
 * lose later: the workspace closes by NAVIGATING (so the URL and the frame can
 * never disagree, including on a back press), and the surface body owns its own
 * scrolling (so a long view inside `h-dvh overflow-hidden` is not clipped
 * unreachable — the defect t-9 hit with the error card).
 *
 * @see components/app/shell/workspace.tsx
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { Workspace } from '@/components/app/shell/workspace';
import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => false }));

/** The conversation renders alongside: the park/un-park cases act on its strip. */
function renderWorkspace(width: WidthName = 'large', pathname = '/app/journey') {
  mockPathname.current = pathname;
  return renderInShell(
    <>
      <ConversationPane />
      <Workspace>the module</Workspace>
    </>,
    width
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/journey';
});

describe('when it is open', () => {
  it('is open on any route below /app, and closed on /app itself', () => {
    renderWorkspace('large', '/app').unmount();
    expect(document.querySelector('[data-pane="ws"]')).toBeNull();

    renderWorkspace('large', '/app/journey');
    expect(document.querySelector('[data-pane="ws"]')).not.toBeNull();
  });

  it('renders whatever the route put in it', () => {
    renderWorkspace();
    expect(screen.getByText('the module')).toBeTruthy();
  });
});

describe('closing it', () => {
  it('closes by navigating, not by calling a setter', () => {
    // `wsOpen` is derived from the route. A button flipping a boolean would be a
    // second source of truth for something the URL already knows, and the two
    // would disagree the moment someone pressed the back button.
    renderWorkspace();
    const back = screen.getByRole('link', { name: /Return to the conversation/ });
    expect(back.getAttribute('href')).toBe('/app');
  });
});

describe('the surface body scrolls, not the frame', () => {
  it('owns its own scroll container', () => {
    // The shell is `h-dvh overflow-hidden`, so without this a long view is
    // clipped with nothing able to reach it — including `error.tsx`, which
    // renders here.
    renderWorkspace();
    const body = screen.getByText('the module');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
  });

  it('leaves room for a focus ring at the horizontal edge', () => {
    // `overflow-y` set to a non-visible value takes `overflow-x` with it, so a
    // ring on a focused control at the edge is clipped without the padding pair.
    // The same trap that clipped the nav's active item in t-9.
    renderWorkspace();
    const body = screen.getByText('the module');
    expect(body.className).toContain('-mx-1');
    expect(body.className).toContain('px-1');
  });
});

describe('the tablet re-parks the conversation', () => {
  it('parks it when the surface is clicked at medium', async () => {
    renderWorkspace('medium');
    const chat = () => document.querySelector('[data-pane="chat"]')!;

    // Un-park first, so this tests the click rather than the initial state.
    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));
    expect(chat().className).toContain('translate-x-0');

    // The surface ITSELF, not something inside it.
    await userEvent.click(document.querySelector('[data-pane="ws"]')!);
    expect(chat().className).toContain('-translate-x-[364px]');
  });

  it('parks on a click anywhere in the body that is not a control', async () => {
    // The guard has to be "not from something interactive", not "only the
    // section itself": the body FILLS the surface, so a tighter rule meant
    // almost every click landed on a child and the gesture stopped working
    // altogether — leaving Escape as the only way to park the conversation.
    renderWorkspace('medium');
    const chat = () => document.querySelector('[data-pane="chat"]')!;

    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));
    expect(chat().className).toContain('translate-x-0');

    await userEvent.click(screen.getByText('the module'));
    expect(chat().className).toContain('-translate-x-[364px]');
  });

  it('does not park when a CONTROL inside the surface is used', async () => {
    // What the guard is actually for: from t-11 the body is full of buttons and
    // links, and using one should do that thing without also collapsing a pane
    // on the other side of the screen.
    mockPathname.current = '/app/journey';
    renderInShell(
      <>
        <ConversationPane />
        <Workspace>
          <button type="button">a control in a view</button>
        </Workspace>
      </>,
      'medium'
    );
    const chat = () => document.querySelector('[data-pane="chat"]')!;

    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));
    await userEvent.click(screen.getByRole('button', { name: 'a control in a view' }));
    expect(chat().className).toContain('translate-x-0');
  });

  it('does nothing on a click at large, where both panes are on screen', async () => {
    renderWorkspace('large');
    await userEvent.click(screen.getByText('the module'));
    expect(screen.queryByRole('button', { name: 'Open the conversation' })).toBeNull();
  });
});

describe('the tone band', () => {
  it('gives the surface a ground the cards on it can be seen against', () => {
    // Not a cosmetic pin. Panels and the placeholder card are
    // `--color-background` with a `--color-card-border` that is FULLY
    // TRANSPARENT in light mode, so on a surface that was also
    // `--color-background` they had neither an edge nor a fill difference —
    // the settings panels simply were not on the page. And because that border
    // is 8% in DARK mode, the two themes disagreed structurally rather than
    // chromatically: a bordered panel in one, nothing at all in the other.
    // `bg-muted` is the prototype's own `.surface`.
    renderWorkspace('large');
    const surface = screen.getByLabelText('Workspace');
    expect(surface.className.split(/\s+/)).toContain('bg-muted');
  });

  it('keeps the head on the other ground, so the band reads as its top edge', () => {
    // The head stays `--color-background` and washes the tone out over 76px.
    // If it inherited the surface's ground there would be nothing for the 3px
    // band to be the top OF, which is how it read in t-10 — a stray rule.
    renderWorkspace('large');
    const head = screen.getByLabelText('Workspace').querySelector('header');
    expect(head?.className.split(/\s+/)).toContain('bg-background');
  });

  it('never puts a color-mix in a CLASS, where Tailwind mis-builds its fallback', () => {
    // Tailwind guards any arbitrary value containing `color-mix()` behind an
    // `@supports` and synthesises the unguarded rule by STRIPPING the mix and
    // keeping its first colour. As a class, the head's 8% wash was therefore a
    // fully saturated slab of the tone on any browser without `color-mix`, with
    // "Return to the conversation" — `text-muted-foreground` — on it at roughly
    // 2:1. The wash is an inline style for that reason.
    //
    // ONLY THE NEGATIVE HALF IS ASSERTED, and that is not laziness. happy-dom
    // cannot parse `color-mix()` inside a gradient and drops the whole
    // declaration silently: the style attribute comes back `null`, so
    // `toContain('color-mix')` on it would fail against working code, and any
    // assertion built to accommodate that would be measuring the environment
    // rather than the component. What can be checked here is the thing that
    // actually regresses — someone moving the wash back into the class list.
    renderWorkspace('large');
    const head = screen.getByLabelText('Workspace').querySelector('header');
    expect(head?.className).not.toContain('color-mix');
  });

  it('drops the band below 900, where the pane switch already rules the top', () => {
    // The second time this line has had to be answered. Below 900px the topbar
    // carries the pane switch, whose active tab has its own accent underline,
    // and this surface starts immediately beneath it: two 3px rules a pixel
    // apart in two colours read as one broken line. That is what got the
    // band's colour fixed in t-10, and it came straight back the moment views
    // started setting a tone. The head's wash still carries the tone there.
    renderWorkspace('small');
    const surface = screen.getByLabelText('Workspace');
    expect(surface.className).not.toContain('border-t-[3px]');
  });

  it('keeps the band at the widths where nothing sits above it', () => {
    // Without this, dropping the band everywhere would pass the case above.
    for (const width of ['large', 'medium'] as const) {
      const { unmount } = renderWorkspace(width);
      expect(screen.getByLabelText('Workspace').className, width).toContain('border-t-[3px]');
      unmount();
    }
  });

  it('is transparent until a view sets a tone', () => {
    // The prototype's own fallback for this band. A visible default was mine,
    // and it painted a teal rule across the top of the workspace at every
    // width — spotted below 900px, where it lands beside the pane switch's
    // accent underline and the two read as one broken two-colour line.
    renderWorkspace();
    expect(document.querySelector('[data-pane="ws"]')?.className).toContain(
      'border-t-[var(--tone,transparent)]'
    );
  });

  it('keeps an inked fallback on the tablet panel, which is an edge not a band', async () => {
    renderWorkspace('medium');
    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));

    expect(document.querySelector('[data-pane="chat"]')?.className).toContain(
      'border-t-[var(--tone,var(--color-secondary-ink))]'
    );
  });
});

describe('the classes survive twMerge', () => {
  /*
   * `cn` is `twMerge(clsx(...))`, so a later class in the same group REPLACES an
   * earlier one — and three of this branch's conditional blocks were being
   * silently deleted that way. Class-name assertions are usually a weak test;
   * here the resolved class list IS the behaviour, because the thing that went
   * wrong was invisible in the source and only appeared after the merge.
   */
  it('keeps the tablet panel transitioning its transform, not its flex-basis', async () => {
    // The worst of the three: this component is built around riding a transform
    // so the workspace never reflows, and the unconditional
    // `transition-[flex-basis]` after it deleted exactly that. The panel popped.
    renderWorkspace('medium');
    const chat = document.querySelector('[data-pane="chat"]')!;

    expect(chat.className).toContain('transition-transform');
    expect(chat.className).not.toContain('transition-[flex-basis]');
  });

  it('keeps the flex-basis transition where it IS the animation', () => {
    renderWorkspace('large');
    const chat = document.querySelector('[data-pane="chat"]')!;

    expect(chat.className).toContain('transition-[flex-basis]');
    expect(chat.className).not.toContain('transition-transform');
  });
});

describe('the tablet panel rides over the surface', () => {
  it('never reflows the workspace when the conversation opens or closes', async () => {
    // The reason the prototype uses a transform rather than a width: with the
    // conversation in the flow, the surface shunts sideways every time it opens.
    // So the assertion is that the surface's own geometry does NOT change.
    renderWorkspace('medium');
    const surface = document.querySelector('[data-pane="ws"]')!;
    const parked = surface.className;

    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));
    expect(surface.className).toBe(parked);
  });

  it('clears the strip with a fixed margin, not a changing width', () => {
    renderWorkspace('medium');
    expect(document.querySelector('[data-pane="ws"]')?.className).toContain('ml-14');
  });

  it('makes the conversation a fixed-width panel, moved by transform', async () => {
    renderWorkspace('medium');
    const chat = document.querySelector('[data-pane="chat"]')!;

    expect(chat.className).toContain('w-[420px]');
    expect(chat.className).toContain('absolute');
    // Parked: translated left by its width less the visible strip.
    expect(chat.className).toContain('-translate-x-[364px]');

    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));
    expect(chat.className).toContain('translate-x-0');
    expect(chat.className).toContain('w-[420px]');
  });

  it('keeps the strip reachable while the panel is parked', () => {
    // The strip rides on the panel's right edge so it lands at the screen edge;
    // if it were a separate pane it would be translated off with everything else.
    renderWorkspace('medium');
    expect(screen.getByRole('button', { name: 'Open the conversation' })).toBeTruthy();
  });

  it('takes the strip away once the panel is open, rather than laying it over the copy', async () => {
    // The strip is pinned to the panel's RIGHT edge. Left rendered while the
    // panel is open it covers the panel's own last 56px — the end of the line
    // and the send button — which is what it was doing. Parked, it is the only
    // thing showing; open, it should be gone.
    renderWorkspace('medium');
    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));

    expect(screen.queryByRole('button', { name: 'Open the conversation' })).toBeNull();
    // And the content it was covering is back.
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' })).toBeTruthy();
  });

  it('is an in-flow column at large, not a panel', () => {
    renderWorkspace('large');
    const chat = document.querySelector('[data-pane="chat"]')!;
    expect(chat.className).not.toContain('absolute');
    expect(chat.className).not.toContain('w-[420px]');
  });
});
