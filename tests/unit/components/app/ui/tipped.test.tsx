// @vitest-environment happy-dom

/**
 * The brand tooltip — the three properties a screenshot cannot check.
 *
 * 1. **It does not fire on touch.** A hover tooltip that latches on tap sits
 *    over the very thing it describes, which on the ≤900px rail is a
 *    thumb-sized button. This is t-35's second capture note, and it is a
 *    property of the pointer type rather than of any layout.
 * 2. **It is not the accessible name.** Every caller already names its control;
 *    a bubble that IS the name is a name nobody reading with a screen reader
 *    can reach.
 * 3. **It is mounted from the start.** Mounting on hover gives the browser
 *    nothing to transition from — the same trap `drawer.tsx` documents.
 *
 * @see components/app/ui/tipped.tsx
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tipped } from '@/components/app/ui/tipped';

function renderTipped(label: string | null = 'Your map — the sixteen modules') {
  return render(
    <Tipped side="left" label={label}>
      {(tip) => (
        <button type="button" {...tip} aria-label="Your map">
          <span aria-hidden="true">icon</span>
        </button>
      )}
    </Tipped>
  );
}

/** The bubble is the trigger's next sibling, by construction. */
const bubble = () => screen.getByRole('button').nextElementSibling;

describe('Tipped', () => {
  it('is in the DOM before anything hovers it, invisible and parked off-screen', () => {
    // Off-screen matters as much as invisible. A `fixed` element with no
    // top/left falls back to its STATIC position — in the flow, right after the
    // trigger — so an unmeasured bubble is not nowhere, it is in the nav.
    renderTipped();
    expect(bubble()?.textContent).toBe('Your map — the sixteen modules');
    expect(bubble()?.className).toContain('invisible');
    expect(bubble()?.className).toContain('opacity-0');
    expect((bubble() as HTMLElement).style.top).toBe('-9999px');
  });

  it('fades out where it faded in, rather than flashing back up the menu', async () => {
    // The defect: position and visibility were one nullable value, so hiding
    // cleared the coordinates and the 160ms opacity fade ran from the bubble's
    // static position at the top of the nav. The coordinates are sticky now —
    // written on the way in, never cleared.
    renderTipped();
    const trigger = screen.getByRole('button');
    await userEvent.hover(trigger);
    const placed = (bubble() as HTMLElement).style.top;
    expect(placed).not.toBe('-9999px');

    await userEvent.unhover(trigger);
    expect(bubble()?.className).toContain('invisible');
    expect((bubble() as HTMLElement).style.top).toBe(placed);
  });

  it('shows on a mouse pointer', async () => {
    renderTipped();
    await userEvent.hover(screen.getByRole('button'));

    expect(bubble()?.className).toContain('visible');
    expect(bubble()?.className).toContain('opacity-100');
  });

  it('hides again when the pointer leaves', async () => {
    renderTipped();
    const trigger = screen.getByRole('button');
    await userEvent.hover(trigger);
    await userEvent.unhover(trigger);

    expect(bubble()?.className).toContain('invisible');
  });

  it('does NOT show on a touch pointer', async () => {
    // The case the whole guard exists for. `userEvent.hover` sends a mouse
    // pointer, so the touch one has to be dispatched directly.
    renderTipped();
    const trigger = screen.getByRole('button');
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'touch', bubbles: true })
      );
    });

    expect(bubble()?.className).toContain('invisible');
  });

  it('is hidden from assistive technology, because the control is already named', () => {
    renderTipped();
    expect(bubble()?.getAttribute('aria-hidden')).toBe('true');
    // And the name the reader gets is the control's own, not the bubble's.
    expect(screen.getByRole('button', { name: 'Your map' })).toBeTruthy();
  });

  it('hangs off the right of the trigger when the side says so', async () => {
    // The collapsed left menu points right; the panel rail points left. The two
    // are different declarations — `left: box.right + 12` against
    // `right: innerWidth - box.left + 12` — so one being correct says nothing
    // about the other.
    render(
      <Tipped side="right" label="Your journey — Where you have been">
        {(tip) => (
          <button type="button" {...tip} aria-label="Your journey">
            <span aria-hidden="true">icon</span>
          </button>
        )}
      </Tipped>
    );
    await userEvent.hover(screen.getByRole('button'));

    const el = bubble() as HTMLElement;
    expect(el.style.left).not.toBe('');
    expect(el.style.right).toBe('');
  });

  it('dismisses when the page scrolls under a resting pointer', () => {
    // The coordinates are a snapshot, so scrolling the nav's item list on a
    // short viewport leaves the bubble behind. Dismiss rather than re-measure:
    // a tooltip is momentary, and re-measuring every scroll frame is work for
    // something the reader has stopped looking at.
    renderTipped();
    const trigger = screen.getByRole('button');
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true })
      );
    });
    expect(bubble()?.className).toContain('visible');

    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(bubble()?.className).toContain('invisible');
  });

  it('dismisses on a resize, which moves the trigger out from under it', () => {
    renderTipped();
    act(() => {
      screen
        .getByRole('button')
        .dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true }));
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(bubble()?.className).toContain('invisible');
  });

  it('shows on keyboard focus and not on a focus that merely landed there', () => {
    // `:focus-visible` is the browser's own answer to "did they mean to be
    // here", and it is already what every focus ring in this shell is drawn
    // from. A tap that moves focus into a button must not raise the bubble.
    //
    // The selector is stubbed in both directions rather than driven through the
    // harness: happy-dom resolves `:focus-visible` as plain `:focus`, so a real
    // programmatic focus would match it and the negative case would pass for
    // the wrong reason — which is exactly the shape of test this component's
    // touch guard exists to avoid.
    renderTipped();
    const trigger = screen.getByRole('button');
    const real = trigger.matches.bind(trigger);
    let keyboard = false;
    trigger.matches = (selector: string) =>
      selector === ':focus-visible' ? keyboard : real(selector);

    act(() => {
      trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(bubble()?.className).toContain('invisible');

    keyboard = true;
    act(() => {
      trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(bubble()?.className).toContain('visible');

    act(() => {
      trigger.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(bubble()?.className).toContain('invisible');
  });

  it('renders no bubble and no handlers when there is no label', () => {
    renderTipped(null);
    expect(screen.getByRole('button').nextElementSibling).toBeNull();
  });

  it('dismisses on a press, so it does not sit over what it described', async () => {
    // Pressing the rail opens a drawer that slides in from under the bubble.
    renderTipped();
    const trigger = screen.getByRole('button');
    await userEvent.hover(trigger);
    expect(bubble()?.className).toContain('visible');

    // `pointerdown` directly, not `userEvent.click`: user-event re-asserts the
    // pointer's position before pressing, which re-fires `pointerenter` on a
    // target it is already over. A real browser does not, so clicking through
    // user-event would be testing the harness rather than the component.
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true })
      );
    });
    expect(bubble()?.className).toContain('invisible');
  });
});
