---
name: app-emails
description: Lelañea's own auth emails — which platform templates are replaced through the seam, which are deliberately not, and the rules the replacements follow.
---

# Emails

The platform sends five auth emails (`lib/email/registry.ts`: `welcome`,
`verifyEmail`, `resetPassword`, `invitation`, `changeEmailApproval`) and lets a
leaf swap any of them through `lib/app/emails.ts`. Lelañea swaps two.

| Kind                  | Template                               | Why                                                                                                                     |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `welcome`             | `components/app/emails/welcome.tsx`    | The platform's is a starter template's welcome. Ours is her words.                                                      |
| `invitation`          | `components/app/emails/invitation.tsx` | The platform's promises "your personalized dashboard" and "your team". Neither exists here.                             |
| `verifyEmail`         | platform default                       | Neutral, security-worded, names the product through `BRAND.name`. Only the chrome is generic.                           |
| `resetPassword`       | platform default                       | Same.                                                                                                                   |
| `changeEmailApproval` | platform default                       | Same. Re-deriving the platform's security wording just to restyle it is its own piece of work, not a bug's — see below. |

And one that is not a platform kind at all — the registry has no waitlist
email to override, so `lib/app/waitlist/confirmation.ts` sends
`components/app/emails/waitlist-confirmation.tsx` itself, from the route's
`after()`. Same chrome; see [`waitlist.md`](./waitlist.md#the-confirmation-email)
for the four rules it follows.

**Never edit `emails/*.tsx`.** They are Sunrise's; every edit is a merge conflict
on the next sync. Copy, adapt, register. `tests/unit/lib/app/defaults.test.ts`
pins the seam to exactly these two, so a third swapped without a decision — or
one of these dropped — fails there.

## The chrome: `components/app/emails/lelanea-email.tsx`

One frame for every leaf-owned email: the lotus, the wordmark, the oyster
ground, the reason-for-receipt and the legal line. Templates put words in
`children`. Things that look removable and are not:

- **The palette is written out** because email has no `var()`. It is the light
  set from `app/brand-theme.css` by token name, and `lelanea-email.test.tsx`
  reads the CSS and pins each value — that test is the only thing tying the two
  together, and it is not always-run, so a theme change alone will not select
  it. Known gap, named there.
- **The ground is our own `Section`, not `Body`'s background.** React Email
  mirrors `Body`'s inline style onto a wrapping `<td>` with no class; a
  dark-mode rule on `<body>` recoloured the body and left a light ground
  painted over it. The rule targets `.lelanea-ground`.
- **Dark mode is a courtesy, not a guarantee.** Apple Mail and Outlook honour
  the `prefers-color-scheme` block in `<Head>`; Gmail ignores it and inverts on
  its own. The real guarantee is the palette — nothing pure white on pure black
  — and a transparent lotus PNG that sits on either ground.
- **The lotus is `public/lotus-mark.png`**, rendered from the SVG at 2×,
  because Gmail strips `<svg>` and blocks SVG image sources. It is referenced by
  absolute URL from `baseUrl`; the invitation kind gets no `baseUrl` from the
  platform, so it reads the origin off `invitationUrl`.
- **No custom font.** The display serif does not load in email; the wordmark
  and her beats fall to Georgia, which is what `--font-serif` falls to anyway.

## The welcome is the Initiation, verbatim

Her words are never paraphrased in the build ([`content.md`](./content.md)). So
the greeting is `the_initiation`'s `welcome` section, "Welcome,
{{first_name}}." through "Welcome to Lelañea.", read from the database by
section key, exactly as the landing page reads its excerpts. It is rendered one
beat per `<Text>` because the document's `renderStyle: 'cadence'` says so. The
key is stored on the blocks, so a beat inserted above it cannot shift the email
to end mid-thought. The read is an async child component, which
`@react-email/render` waits for, so a content failure still lands inside
`sendEmail`'s own `try`.

What follows her beats — "Your account is ready…" — is the build's, in the
shell's plain register, about the mechanics only. It is visually a different
face and size on purpose.

**The first name.** The merge field takes the reader's first name or the
sentence closes over the gap (D7, `applyFirstName`). The platform passes
`user.name || 'User'`, never `null`, so `firstNameFrom` treats the literal
`'User'` as no name. That is a coupling to a string in Sunrise-owned
`lib/auth/config.ts`, pinned by a test; the honest fix is upstream (pass `null`
through).

**The beats are read at render time, not in the template body.**
`resolveEmailTemplate` calls the template as a plain function while the
argument to `sendEmail()` is still being built — before the `.catch()` the
signup after-hook relies on. A loader throw in the body would abort account
creation; inside the `WelcomeBeats` child it lands in `render()`, inside
`sendEmail`'s own `try`, and is logged as a failed welcome. The range pin makes
that throw unlikely; the child makes it survivable. `welcome.test.tsx` asserts
the loader is not touched by the function call, only by the render.

**The action is `/app`**, via `appAuthLandingRoute` — not the platform's
`/dashboard`. A new account lands on the gate (`/app/begin`) from there.

## The invitation borrows nothing

The foundational documents address someone who has already arrived. An
invitee has not, so the invitation stays in the product's own register and
describes what this is with the product description's sentence, not hers —
lifting a phrase of hers into the build's sentence is the paraphrase the
content rule forbids, and `invitation.test.tsx` pins the one that nearly
shipped. Her words are for the welcome that follows acceptance.

## Sender identity is configuration

`lib/email/client.ts` builds the sender from `EMAIL_FROM` and
`EMAIL_FROM_NAME`. The name is optional to the platform and not to us: without
it the client shows a bare address. `.env.example` carries Lelañea's values;
the deployed environment has to match, and the address has to be on a domain
verified in Resend. Nothing in code can check that.

## What the seam cannot reach

- **Subjects** are set at the send sites in Sunrise-owned `lib/auth/config.ts`
  (`Welcome to ${BRAND.name}`, `Reset your password`…). They are neutral and
  brand-named, so nothing is wrong today; but a subject in her voice would need
  the seam to carry subjects, which is an upstream ask, not a leaf edit.
- **The verify email arrives first** when verification is required, and it is
  the platform's chrome. If that inconsistency is worth closing, it is the
  "three security emails in Lelañea's chrome" follow-up, not this doc's rule.

## See also

- [`content.md`](./content.md) — seed input vs. what is served, the never-paraphrase rule
- [`brand-theme.md`](./brand-theme.md) — the tokens the palette copies
- `.claude/skills/email-designer/SKILL.md` — the platform's conventions
