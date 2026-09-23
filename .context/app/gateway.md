---
name: app-gateway
description: The gate in front of the shell — the acknowledgement ledger, its API, and what re-gates.
---

# The gateway

Nobody reaches the shell without acknowledging the Disclaimer and the Terms of
Use and confirming they are eighteen or over, and a person can leave with their
data (§06). This doc covers the **ledger** and its API (t-15), the **gate** in
front of the shell (t-16), and the two **data rights** on the account view
(t-17).

## The pieces

| Piece                                     | Path                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| Model + enum                              | `prisma/schema/app.prisma` — `AppAcknowledgement`          |
| Migration (hand-written FK, see below)    | `prisma/migrations/20260914121123_app_acknowledgement/`    |
| Ledger module — required versions, status | `lib/app/gateway/acknowledgements.ts`                      |
| Kinds (client-safe; no Prisma behind it)  | `lib/app/gateway/kinds.ts`                                 |
| Validation                                | `lib/validations/app-acknowledgement.ts`                   |
| Routes                                    | `app/api/v1/app/acknowledgements/route.ts` (`GET`, `POST`) |
| Art. 15 declaration + collector           | `lib/app/leaf-data-export.ts` — section `acknowledgements` |
| Art. 17 — the cascade, pinned             | `lib/app/leaf-db-drift.ts`                                 |
| The gate — where a person is sent         | `lib/app/gateway/gate.ts`                                  |
| The redirect                              | `app/(lelanea)/app/layout.tsx`                             |
| The gate page, `/app/begin`               | `app/(gate)/app/begin/page.tsx`                            |
| The gate's controls (client)              | `components/app/views/begin-view.tsx`                      |
| The export control (client)               | `components/app/account/export-data-row.tsx`               |
| Both rights, one subject, end to end      | `tests/unit/lib/app/privacy/subject-rights.test.ts`        |

## The model, and the one rule it encodes

One row is one acknowledgement: `userId`, `kind`, `documentVersion`,
`acknowledgedAt`. Three kinds:

| Kind         | Stands for                          | `documentVersion` is                              |
| ------------ | ----------------------------------- | ------------------------------------------------- |
| `disclaimer` | the `disclaimer` document           | that document's `version` (`1.1` at seed)         |
| `terms`      | the `terms_of_use` document         | that document's `version` (`1.1` at seed)         |
| `age_18`     | the eighteen-plus confirmation (A7) | `AGE_18_VERSION`, a constant naming the threshold |

**A kind is satisfied by a row at the version required _now_, not by ever
having been acknowledged.** `getRequiredVersions()` reads each legal document's
`version` from `app_foundational_document` on every call, and
`getGateStatus(userId)` matches rows against it. So changing a document's
version re-gates that document for everyone by construction, and nothing in this
module has to notice. The age confirmation stands, because its constant did not
move. The superseded rows stay: they are the record of what was agreed before,
and the export returns them.

**The version is per document (t-86).** Until t-86 both kinds read the
collection's `version` in `content/lelanea_foundational_documents.json`, so a
typo fix to `about_the_creator` with a version bump would have re-gated everyone
on unchanged legal text. The documents now live in the database, each with two
counters:

- `version`: the label a person agrees to, and what the gate requires. The seed
  sets it to the collection's `1.1` for every document, so the move re-gated
  nobody.
- `revision`: bumped by every write, with a full snapshot in
  `app_foundational_document_revision`.

One authoring rule follows, and the code cannot enforce it: **an edit to the
Disclaimer or the Terms that people must agree to again has to change that
document's `version`.** A typo fix need not. Without the change nobody is
re-gated, and people are bound by text they never saw. The admin editor (t-91)
makes that the default rather than a choice: a save that changes the title,
subtitle or blocks of a document with `requiresAcknowledgement`, and leaves its
version alone, mints the next one (`1.1` → `1.2`), and the editor says so beside
the Save button. A restore of earlier words mints too. An import is refused
instead of minting (so a second apply stays a no-op): the file must carry the
new version. The revision history is how to see what was in force on a given
day.

**Insert-only.** No `updatedAt`; nothing updates or deletes a row except
erasure. `@@unique([userId, kind, documentVersion])` is what makes a repeat
idempotent — `recordAcknowledgement` inserts first and answers a `P2002` with
the existing row and its _original_ `acknowledgedAt`, because the record is of
the first time they agreed to this version, not the latest click.

**The mapping is explicit, and pinned both ways.** `DOCUMENT_FOR_KIND` names the
document behind each document kind (the kind is a database enum, so it cannot
be derived from content at runtime). `tests/unit/lib/app/gateway/acknowledgements.test.ts`
asserts the other direction against the real content file: every document with
`requiresAcknowledgement: true` has a kind. An author adding a third legal
document that nobody is asked to agree to fails CI.

## The API

Both verbs are `withAuth`, then refuse an **API-key session** with 403
(`isApiKeySession()`). Acknowledging the terms and confirming one's age are
identity acts; a key acts _as_ its owner, which is exactly the property that
makes it wrong here. The read refuses too, so a client cannot read the gate as
proof the key may proceed.

Both verbs declare `ownership: { decidedBy: 'self' }` (Sunrise 0.12.0's
authorization seam — `.context/auth/authorization.md`): every read and write is
keyed on `session.user.id`. Not `'policy'` — `subjectScope` widens to `{}` for
a platform admin, which on a self endpoint would hand an admin everyone else's
gate status. The declaration is load-bearing: without it the guard answers
every non-admin member 500 (`OwnershipDecisionMissingError`).

- `GET /api/v1/app/acknowledgements` — the caller's `GateStatus`: `complete`,
  `outstanding[]`, and `kinds[]` each with `requiredVersion`, `documentId`
  (`null` for `age_18`), `satisfied`, `acknowledgedAt`.
- `POST /api/v1/app/acknowledgements` — body `{ kind }`, strict. Answers **201**
  when this call recorded it, **200** when it already stood, both with the
  status _after_ the write so the client needs no second read. `400` on an
  unknown kind, and on any extra field — **the version is never in the
  request.** It is decided server-side from what is currently served, so a
  client cannot satisfy the gate by naming a version it read last year.

Rate limit: the `/api/v1/**` section cap only. Three writes per person per
version is the route's lifetime traffic.

## The gate

`gateRedirectFor(user)` in `lib/app/gateway/gate.ts` answers one question for
the shell layout: where does this person go, or `null` when they may enter.
Two checks, in this order:

1. **Verification.** An unverified address goes to Sunrise's `/verify-email`
   (with `?email=` so the resend works) — but only when the platform is
   requiring verification: `REQUIRE_EMAIL_VERIFICATION ?? NODE_ENV ===
'production'`, the same expression `lib/auth/config.ts` applies to sign-in,
   restated here because the platform does not export it and pinned by
   `gate.test.ts`. When it is off nobody is ever sent a verification email, so
   a gate that demanded one would lock every local account out with nothing to
   click. `.env.development` sets it `false` explicitly for local work;
   `.env.example` documents the knob but deliberately leaves it unset, because
   the self-hosted deploy docs copy that file to a production `.env`.
2. **The ledger.** Any kind outstanding at its current version → `/app/begin`.

Verification is checked first, so an unverified address costs no query and is
not asked to agree to anything before proving it is someone's.

### Why the gate is in the layout, and why `/app/begin` is not

The edge (`proxy.ts`) already keeps a signed-out visitor away from `/app/**` —
`lib/app/protected-routes.ts` lists `/app` and matching is by prefix — but the
edge has no database, so the ledger is read in `app/(lelanea)/app/layout.tsx`,
server-side, on entry. A layout is not re-rendered between sibling pages, and
that is enough: there is no way into the shell that does not pass through it,
and nothing inside the shell un-acknowledges anything.

**`/app/begin` lives in `app/(gate)/app/begin/`, a sibling route group** with
the same URL prefix and no shell chrome. It cannot sit under the shell layout:
that layout redirects to `/app/begin`, and a page under it would be redirected
to itself forever. The task sketch put it under `(lelanea)`; the tree said no.
Static routes beat the shell's `[...slug]` catch-all, so the URL resolves to the
gate page. The page wraps itself in the maintenance wrapper for the reason the
shell does, and applies the verification redirect itself, since it is outside
the layout that would otherwise do it.

### The page — one thing at a time

The first cut put both documents in full on one page with the controls at the
bottom: about ten screens of legal text before the first button. The owner's
reaction was that anyone landing there would leave and not come back — the
gate failing at its one job. So the page is **three steps**, each a single
viewport: the step's heading ("First, what this is — and what it is not."), the
document in a pane that scrolls on its own, and the control always in view
beneath it. The text is still there in full, and it is still read before it is
agreed to; it is just not a wall. The third step, age, has no document.

The current step is the **first outstanding kind**, so someone who did two of
three last week lands on the third. There is no "back": an acknowledged
document is on its public page (`/disclaimer`, `/terms`), and the record
screen links there.

The documents are rendered on the server through `AuthoredBlocks` (not
`AuthoredDocument`, which renders an `<h1>`; the step has one, the document's
own title sits at `<h2>`) and handed to `BeginView` as nodes. The controls are
the only client state: a click `POST`s `{ kind }` and **replaces the whole
status with the server's answer** rather than flipping a flag, which is what
moves the step on — and what keeps a second tab or a version bump between
paint and click from leaving the page showing a state the ledger does not
hold.

Afterwards the page is the **record**: "This stands.", the three facts with
their dates, "Read it again" to each public page, and one way on — `Begin`
(to `/app`) for the person who just finished the third step, `Return` (to
`/app/account`) for one who came back to read it and began some time ago.
The view tells them apart by whether it was loaded already complete. The
layout no longer redirects here, but "what did I agree to, and when" stays
answerable without asking us — and reachable: the account view's "your data"
section carries a "What you agreed to" row to `/app/begin`, above the erasure
row, the only link to it from inside the shell.

Copy is in the prototype's register — sentence case, no exclamation points,
`Begin` not "Start now", and the design guide's own error line ("Something
didn't land. Try that once more."). The record date is formatted in UTC so
server and browser agree on the string; the cost is a date that can sit a day
off for someone far from UTC, on a line whose point is "this stands".

## The two GDPR duties

**Art. 15.** Declared in `initLeafSubjectSources()` as section
`acknowledgements`, disposition `export`, and collected by user id with no
version filter — superseded rows are still held, so they are still disclosed.

**Art. 17 — the cascade _is_ the policy, and that is the difference from the
waitlist.** `userId` is a plain scalar with no `@relation` (a fork table must
not add a reverse field to Sunrise's `User`), so the FK is hand-written in the
migration with `ON DELETE CASCADE`. There is no email on the row and no
pre-signup path, so unlike `app_waitlist_entry` no erasure hook is needed: when
`eraseUser()` deletes the user, Postgres removes the rows. Three things keep
that true:

1. The migration names the **mapped** table (`"user"`, not `"User"`) — B11.
2. `lib/app/leaf-db-drift.ts` pins the constraint's _definition_, not just its
   existence — `SET NULL` would fail on the NOT NULL column, `NO ACTION` would
   fail every erasure with `P2003`. `npm run db:drift-check` runs it.
3. `tests/unit/lib/app/gateway/privacy.test.ts` asserts the migration SQL and
   that no hook deletes these rows explicitly — if one appears, the code and
   the migration comment have started telling different stories.

**Migrations on this table are authored with `--create-only` and applied with
`db:migrate:deploy`**, never `migrate dev`. Prisma cannot see the hand-written
FK, so `migrate dev` emits a DROP for it (and for every other unmodelled object
in the tree — 20 statements this time, all stripped; the migration's header
lists them). See B13 and the waitlist migration for the same story.

## The two data rights, on the account view (t-17)

Data rights ship with accounts whatever else slips. What the tree had when this
was claimed was the inverse of the plan's hypothesis: **deletion UI existed**
(Sunrise's `DeleteAccountForm` on `/settings?tab=account` — a typed
confirmation, and `DELETE /api/v1/users/me` asks for the password before it
calls `eraseUser()`), and **export UI did not** — only
`GET /api/v1/users/me/export`, which the account view linked at directly.

So the two rights live in two different places, on purpose:

- **Erasure** stays Sunrise's. The account view's "Close your account and erase
  it" row leads to the settings form. Not rebuilt in the shell: a second
  erasure path is the one thing `CLAUDE.md` forbids outright, and the second
  one is always the one that misses a security fix.
- **Export** is ours: `ExportDataRow`, a button on the account view. It
  `fetch`es the route and hands the body to the browser as
  `lelanea-my-data-<date>.json` (the reader's calendar date) via `res.blob()`
  — bytes to file, never parsed, as `backup-panel.tsx` does, because the
  bundle is the whole account and `apiClient` would hold a heavy one three
  times over in the tab. The reason it is a fetch and not the link t-11
  shipped: the route answers a rate-limit refusal (10 a minute) and any thrown
  error as a bare JSON envelope with no `Content-Disposition`, and a
  navigation to that put raw `{"success":false,…}` in a tab on an Art. 15
  control. Now a 429 is a sentence in the row, in the register ("You have
  asked for a few copies just now. Give it a minute, then try once more."); a
  401 — a session that ended while the page sat open — goes through the
  clear-session route to sign-in with a way back (a stale cookie would bounce
  `/login` into the shell otherwise), because "try once more" can never
  succeed there. The status line is a sibling of the button, not a child — a
  button's children are presentational, so a live region inside one is never
  announced. It is the one
  button on a page of links, and the view's test says so.

`lib/app/account-sections.ts` is untouched — the shell's account view is our
home for these, not Sunrise's settings page.

**What the bundle contains, for a data subject:** `app.waitlist` (matched by
email as well as user id, because the entry usually pre-dates the account) and
`app.acknowledgements` (by user id, every version ever agreed to), beside the
platform and framework sections. `subject-rights.test.ts` proves both for one
person through the real seams, and that erasure removes the waitlist row by
hook, the person by delete, and the acknowledgements by the cascade — with an
assertion that nothing deletes those by hand, because a hook appearing there
would mean the cascade had been duplicated or replaced.
