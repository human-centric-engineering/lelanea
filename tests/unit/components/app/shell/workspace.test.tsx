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
import { CHAT_DEFAULT, CHAT_MEDIUM } from '@/components/app/shell/use-shell-layout';
import { Workspace } from '@/components/app/shell/workspace';
import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.current,
  // The pane's session offer refreshes the page after a deletion (t-158).
  useRouter: () => ({ refresh: vi.fn() }),
}));
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

describe('a click on the page never parks the conversation', () => {
  it('leaves the conversation open when the surface is clicked at medium', async () => {
    // The re-park gesture belonged to the slide-over, where the conversation
    // covered the page and a click on the page meant "get out of the way".
    // Beside the page (t-83) it covers nothing, so a click on the page is a
    // click on the page — collapsing a pane over it would be a side effect.
    renderWorkspace('medium');

    await userEvent.click(screen.getByText('the module'));
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' })).toBeTruthy();
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

  it('gives the conversation no panel edge at medium, now it is not a panel', () => {
    // The 3px tone edge was the slide-over's, marking it as a panel over other
    // content like the drawers. In the flow it is a column, as at large.
    renderWorkspace('medium');
    expect(document.querySelector('[data-pane="chat"]')?.className).not.toContain('border-t-[3px]');
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

  it('keeps the flex-basis transition wherever the conversation is in the flow', () => {
    // Medium included since t-83: it is a column there too, so opening and
    // closing it animates its basis rather than riding a transform.
    for (const width of ['large', 'medium'] as const) {
      const { unmount } = renderWorkspace(width);
      const chat = document.querySelector('[data-pane="chat"]')!;

      expect(chat.className, width).toContain('transition-[flex-basis]');
      expect(chat.className, width).not.toContain('transition-transform');
      unmount();
    }
  });
});

describe('at medium the conversation sits beside the page, not over it', () => {
  /*
   * t-83. The prototype's slide-over was a fixed 420px panel riding OVER the
   * page, and whatever lay under it — headings, cards, body copy — was cut off
   * for as long as the conversation was open. Owner ruling: the two share the
   * width, as at large, with the conversation capped narrower.
   */
  const chat = () => document.querySelector<HTMLElement>('[data-pane="chat"]')!;

  it('is an in-flow column, open on arrival, capped at CHAT_MEDIUM', () => {
    renderWorkspace('medium');

    // In the flow: nothing positioned, nothing overlapping.
    expect(chat().className).not.toContain('absolute');
    expect(chat().className).toContain('flex-none');
    // The stored default is 440; medium caps it.
    expect(chat().style.flexBasis).toBe(`${CHAT_MEDIUM}px`);
    // Open, not parked: the page opening no longer folds the conversation.
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' })).toBeTruthy();
  });

  it('keeps a width the reader chose that is already narrower than the cap', () => {
    // The cap only takes width away. A reader who sized the conversation to
    // 340 at large gets 340 here, not 360.
    window.localStorage.setItem('lelanea.chat.width', '340');
    renderWorkspace('medium');
    expect(chat().style.flexBasis).toBe('340px');
  });

  it('does not cap it at large', () => {
    // Without this, capping at every width would pass the cases above.
    renderWorkspace('large');
    expect(chat().style.flexBasis).toBe(`${CHAT_DEFAULT}px`);
  });

  it('leaves the page no margin to clear — nothing sits over it', () => {
    // `ml-14` cleared the parked panel's strip, which lay over the page's
    // left edge. The strip is in the flow now, so the margin would be a gap.
    renderWorkspace('medium');
    expect(screen.getByLabelText('Workspace').className).not.toContain('ml-14');
  });

  it('folds to the strip in the flow, and back', async () => {
    renderWorkspace('medium');

    await userEvent.click(screen.getByRole('button', { name: 'Collapse the conversation' }));
    expect(screen.queryByLabelText('Conversation')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' })).toBeTruthy();
  });

  it('offers the resize handle at large only', () => {
    // 330–660 of play is meaningless in a band where the page has ~400px.
    renderWorkspace('medium').unmount();
    expect(screen.queryByRole('separator', { name: 'Resize the conversation' })).toBeNull();

    renderWorkspace('large');
    expect(screen.getByRole('separator', { name: 'Resize the conversation' })).toBeTruthy();
  });
});
