// @vitest-environment happy-dom

/**
 * The temporary tint picker (f-prism t-180; deleted with it by t-181).
 *
 * What fails silently, and so is pinned here:
 *
 *  1. **Off means absent.** With the flag unset the gate renders nothing, so no
 *     script runs and no tint attribute is ever set — production serves the
 *     palette as it ships.
 *  2. **A choice survives a reload.** Choosing writes the attribute and the
 *     store; the pre-paint script reads the store back onto a fresh page.
 *  3. **A blocked store is not an error.** Every access is wrapped: the page
 *     still changes, the script still runs, the picker still opens on the
 *     default.
 *
 * The gate is synchronous and returns the async script beside the controls;
 * the script is awaited rather than rendered, and what it returns is rendered. The pre-paint script is run as the
 * browser would run it, on a page with no attributes, which is what a reload
 * starts from.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ on: false }));

vi.mock('@/lib/env', () => ({
  env: {
    get LELANEA_TINT_PICKER() {
      return flag.on;
    },
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-nonce': 'test-nonce' }),
}));

import { TintPicker, TintScript } from '@/components/app/ui/tint-picker';
import { TintPickerControls } from '@/components/app/ui/tint-picker-controls';
import { TINT_SCRIPT, TINT_STORAGE_KEY } from '@/components/app/ui/tints';

const root = document.documentElement;

/** What a reload does: a fresh `<html>`, then the script before first paint. */
function reload() {
  root.removeAttribute('data-tint');
  root.removeAttribute('data-tint-dark');
  // The exact string the page inlines, run as the browser runs it — the point
  // of the test, so the implied-eval rule does not apply here.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(TINT_SCRIPT)();
}

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'tints' }));
}

beforeEach(() => {
  flag.on = false;
  window.localStorage.clear();
  root.removeAttribute('data-tint');
  root.removeAttribute('data-tint-dark');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TintPicker — the gate', () => {
  it('renders nothing with the flag off, so no tint is ever set', async () => {
    // Stored from an earlier session with the flag on: still nothing applies,
    // because without the gate there is no script to read it.
    window.localStorage.setItem(TINT_STORAGE_KEY.light, 'pearl');
    expect(TintPicker()).toBeNull();
    expect(root.hasAttribute('data-tint')).toBe(false);
    expect(root.hasAttribute('data-tint-dark')).toBe(false);
  });

  it('renders the pre-paint script and the picker with it on', () => {
    flag.on = true;
    const children = React.Children.toArray(
      (TintPicker() as React.ReactElement<{ children: React.ReactNode }>).props.children
    ) as React.ReactElement[];
    expect(children.map((child) => child.type)).toEqual([TintScript, TintPickerControls]);
  });

  it('gives the script the request’s nonce, and the catalogue’s text', async () => {
    const { container } = render(await TintScript());
    const script = container.querySelector('script');
    expect(script?.getAttribute('nonce')).toBe('test-nonce');
    expect(script?.innerHTML).toBe(TINT_SCRIPT);
  });
});

describe('TintPickerControls', () => {
  it('opens on the default of each theme when nothing is stored', () => {
    render(<TintPickerControls />);
    expect(screen.queryByRole('group', { name: 'Choose the light' })).toBeNull();
    openPicker();
    expect(screen.getByRole('button', { name: 'Champagne' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Amber smoke' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('sets the light tint, and it survives a reload', () => {
    render(<TintPickerControls />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Pearl' }));
    expect(root.getAttribute('data-tint')).toBe('pearl');
    expect(screen.getByRole('button', { name: 'Pearl' })).toHaveAttribute('aria-pressed', 'true');

    reload();
    expect(root.getAttribute('data-tint')).toBe('pearl');
  });

  it('keeps the dark choice apart from the light one', () => {
    render(<TintPickerControls />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Lilac' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plum dusk' }));
    expect(root.getAttribute('data-tint')).toBe('lilac');
    expect(root.getAttribute('data-tint-dark')).toBe('plum');

    reload();
    expect(root.getAttribute('data-tint')).toBe('lilac');
    expect(root.getAttribute('data-tint-dark')).toBe('plum');
  });

  it('reads the stored choice back when it opens again', () => {
    window.localStorage.setItem(TINT_STORAGE_KEY.dark, 'ember');
    render(<TintPickerControls />);
    openPicker();
    expect(screen.getByRole('button', { name: 'Ember' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('removes the attribute and the stored value when the default is chosen', () => {
    render(<TintPickerControls />);
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Honey' }));
    fireEvent.click(screen.getByRole('button', { name: 'Champagne' }));
    expect(root.hasAttribute('data-tint')).toBe(false);
    expect(window.localStorage.getItem(TINT_STORAGE_KEY.light)).toBeNull();
  });
});

describe('the pre-paint script', () => {
  it('sets nothing for a value it does not know', () => {
    // A stale name from a tint since removed, or anything else written there.
    window.localStorage.setItem(TINT_STORAGE_KEY.light, 'teal');
    window.localStorage.setItem(TINT_STORAGE_KEY.dark, '" onload="x');
    reload();
    expect(root.hasAttribute('data-tint')).toBe(false);
    expect(root.hasAttribute('data-tint-dark')).toBe(false);
  });
});

describe('a store that throws', () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
  });

  it('falls back to the default before paint, without throwing', () => {
    expect(() => reload()).not.toThrow();
    expect(root.hasAttribute('data-tint')).toBe(false);
  });

  it('opens on the default and still changes the page', () => {
    render(<TintPickerControls />);
    openPicker();
    expect(screen.getByRole('button', { name: 'Champagne' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opal' }));
    expect(root.getAttribute('data-tint')).toBe('opal');
    fireEvent.click(screen.getByRole('button', { name: 'Champagne' }));
    expect(root.hasAttribute('data-tint')).toBe(false);
  });
});
