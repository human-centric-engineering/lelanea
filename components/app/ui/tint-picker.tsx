import { headers } from 'next/headers';

import '@/components/app/ui/tints.css';
import { TintPickerControls } from '@/components/app/ui/tint-picker-controls';
import { TINT_SCRIPT } from '@/components/app/ui/tints';
import { env } from '@/lib/env';

/**
 * The temporary tint picker: a small control on every consumer page that lets
 * Lelañea try the prism's light in other tints, in both themes, so she can
 * settle on hers (owner ruling, 3 Nov 2026; f-prism t-180).
 *
 * ## It is deleted by t-181, and this is the list
 *
 * Once she has chosen, f-prism t-181 writes her tints into
 * `app/brand-theme.css` as the defaults and removes the picker by deleting:
 *
 * - `components/app/ui/tint-picker.tsx` (this file)
 * - `components/app/ui/tint-picker-controls.tsx`
 * - `components/app/ui/tints.ts`
 * - `components/app/ui/tints.css`
 * - `tests/unit/components/app/ui/tint-picker.test.tsx`
 * - `tests/unit/components/app/ui/tints.test.ts`
 *
 * and these lines elsewhere:
 *
 * - the mount, `<TintPicker />` in `components/app/ui/prism-ground.tsx`
 * - `LELANEA_TINT_PICKER` in `lib/app/env.ts`, and its pinned row in
 *   `tests/unit/lib/app/defaults.test.ts`
 * - `ui/tints.css` from `LITERALS_PINNED_ELSEWHERE` in
 *   `tests/unit/components/app/ui/tokens-only.test.ts`
 *
 * ## Off unless the flag is on
 *
 * `LELANEA_TINT_PICKER=true` turns it on; unset or anything else, this renders
 * nothing and no tint attribute is ever set, so a deployment without the flag
 * serves exactly the palette that ships. A preview carries the flag for her;
 * production never does.
 *
 * ## Why it is mounted inside `PrismGround`
 *
 * The shell and the public site are different layouts, and the picker has to
 * be on both. The one component every consumer frame mounts — the public
 * layout, the begin page and the shell — is the prism ground, so mounting the
 * picker there is a single line for t-181 to remove. `/admin` mounts no ground,
 * so it gets no picker.
 *
 * ## Before first paint
 *
 * The script is inline, ahead of the ground it retints, so a reload paints the
 * chosen tint rather than flashing the default first. Production's CSP allows
 * an inline script only with the request's nonce, which is why the script is a
 * server component that reads it, as the root layout does for the theme script.
 */
export function TintPicker() {
  if (!env.LELANEA_TINT_PICKER) return null;
  return (
    <>
      <TintScript />
      <TintPickerControls />
    </>
  );
}

/**
 * The pre-paint script, apart from the gate so the gate can stay synchronous:
 * with the flag off — every test that renders a frame, and production —
 * nothing async is ever rendered, so a frame's own tests need no knowledge of
 * the picker.
 */
export async function TintScript() {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: TINT_SCRIPT }}
    />
  );
}
