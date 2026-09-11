---
name: waitlist
description: The public waitlist — the model, the routes, the admin surface that reads it back, and the two GDPR duties that come with keeping someone's answers.
---

# The waitlist

The app is not open, so the waitlist is the only thing a visitor can actually
do — and what they say while doing it is the point, not a by-product. `intent`
("what would you want to achieve?") is read by Lelañea herself while there are
few enough entries to read one by one, and it is meant to seed that person's
profile if they later sign up.

That makes this the first place the leaf stores personal data about someone who
has no account, which is why half of this page is about Articles 15 and 17.

## The pieces

| Piece                                   | What it is                                                           |
| --------------------------------------- | -------------------------------------------------------------------- |
| `prisma/schema/app.prisma`              | `AppWaitlistEntry` → `app_waitlist_entry`, the leaf's first table    |
| `lib/validations/app-waitlist.ts`       | The Zod schemas, the honeypot split, and the copy a visitor is shown |
| `lib/app/waitlist/service.ts`           | The write, the Art. 15 read, the Art. 17 delete                      |
| `lib/app/waitlist/rate-limit.ts`        | The per-flow sub-cap — 5 an hour, per IP                             |
| `lib/app/waitlist/locale.ts`            | Which language the joiner arrived in                                 |
| `lib/app/waitlist/endpoint.ts`          | The route's path, in one place                                       |
| `app/api/v1/app/waitlist/route.ts`      | `POST` — the only unauthenticated write the leaf owns                |
| `components/app/site/waitlist-form.tsx` | The card at the end of the home page's hero column                   |

And the read surface, which landed a task later (t-8):

| Piece                                           | What it is                                                |
| ----------------------------------------------- | --------------------------------------------------------- |
| `lib/app/leaf-admin-nav.ts`                     | The "Lelañea" admin sidebar section, pointing at the list |
| `lib/app/waitlist/admin.ts`                     | The search clause, the two queries, and the CSV           |
| `app/api/v1/admin/app/waitlist/route.ts`        | `GET` — the paginated list, behind `withAdminAuth`        |
| `app/api/v1/admin/app/waitlist/export/route.ts` | `GET` — the CSV attachment, sub-capped at 10/min          |
| `app/admin/app/waitlist/page.tsx`               | The page, server-rendering the first page through the API |
| `components/app/admin/waitlist-table.tsx`       | The table: search, pager, per-row "show all", export link |

## The fields, and why these four

D2 (owner, §03) ruled the set: **email required; name, `heardFrom` and `intent`
optional.** The prototype asked for an email and "What brings you here?"; D2 is
the later decision and is what ships. The card's own copy — heading, note, and
the closing privacy sentence — is still the prototype's, word for word.

`source` is an enum with two values. Only `form` is ever written today;
`conversation` is reserved for the path the product description describes
(someone asking to be told, in a conversation with the agent) and has no code
behind it. It is here now because adding an enum value later is a migration on a
table that will by then hold real people.

`locale` records the language the visitor's own browser asked for. The site is
single-locale — `app/layout.tsx` hard-codes `lang="en"` and the authored
collection is `en-US` — so storing that constant would have been a column that
looks like data and is a copy of a literal. `Accept-Language` is the one honest
source of provenance available, with the collection locale as the fallback.

## Joining

`POST /api/v1/app/waitlist` answers **200 to every accepted request** — a first
join, a repeat, or a bot in the honeypot — with the same body and the same
headers.

**That uniformity is the design, and three separate things had to agree for it
to hold.** The body is one fixed sentence. The status is a single 200: the task
specified 201-on-first / 200-on-repeat, which is REST-correct and is a
membership oracle — post an address, read the status, learn whether that person
is on a pre-launch list — and it bought nothing observable, since the form
treats both codes identically, so the owner collapsed it (ruling, 10 September
2026). And the headers match, which is the one that nearly got away: an earlier
version answered the honeypot from a `catch` block that could not see the
rate-limit headers, so header _presence_ was a perfectly reliable tell for which
field was the trap.

`created` is still computed — it is in the log line, where it is useful — and
never travels back out.

**A repeat updates rather than conflicting, and the update is strictly
additive**: it fills a field that is still empty and never overwrites one that
is not, never moves `consentedAt`, and never moves `locale`.

That is not squeamishness about lost text. **Nothing on this route proves the
submitter owns the address** — no confirmation email this phase (A8), no token —
so `email` is a string a stranger typed. With overwrite allowed, anyone who
knows someone's address can replace up to 2000 characters of `intent`, which
Lelañea reads herself and which is meant to seed that person's profile, with
whatever they like. The victim cannot tell: the form never shows a stored value.
And `consentedAt` records that _this person_ agreed to the notice above the
button, so a third party's POST moving it would write a consent that did not
happen into the one field whose whole job is to be true (Art. 7(1)).

The blank-field half of the same rule covers the honest case: the form always
renders empty, so a returning visitor re-submitting just their email — because
they are not sure the first one landed — must not lose what they wrote before.
The create path still writes `NULL` for a blank, where there is nothing to
preserve.

**The cost is the correction case.** Someone who wants to _change_ an answer
cannot do it here. That is the right way round while there is no proof of
ownership — she reads these by hand — and the honest fix is a signed
confirmation link, which is the same mechanism the first waitlist email needs
anyway.

**What additive still leaves open, stated rather than implied.** A stranger can
_seed_ a field the person left empty, and it will read as theirs. That is a
smaller surface than the one it replaces — append into a gap, never replacement
or destruction — and closing it entirely would mean a repeat changed nothing at
all, which breaks the ordinary case of someone coming back to add the answer
they skipped. It closes properly with the same confirmation link.

**No email is sent** (A8, owner). The response is the only acknowledgement, and
the card says so in place.

### Rate limiting — two layers

`proxy.ts` applies the `'api'` section cap (100/min) before the handler runs,
keyed on `ip:<addr>` for an anonymous caller. The handler adds the per-flow
sub-cap of **5 an hour per IP**, which is the layer that matters for a public
write. It is a limiter of our own rather than `contactLimiter`: sharing that
bucket would mean sending a message through the contact page spent a waitlist
join. Handlers never call a section limiter themselves — see
[`../security/rate-limiting.md`](../security/rate-limiting.md).

### The honeypot

`website` must be empty. The **client** schema accepts any value and the
**server** schema rejects a filled one — the same split as
`lib/validations/contact.ts`, and for the reason a honeypot exists: a client
that rejected it would tell the bot which field it is.

**The decision is made on the VALUE, in the handler — not on a validation
error.** `website` is `z.unknown().optional()` and never fails validation;
`isHoneypotFilled()` decides, and the swallow is built on the same line as a
genuine answer so status, body and headers match by construction.

Two earlier shapes were wrong in opposite directions, and both are worth knowing
about because each reads like the careful choice:

- **`z.string().max(0)` in the schema.** The route could then only recognise a
  hit by the thrown error's field _path_ — which matches on the FIELD, not on
  what was in it. `{"email":"ada@example.com","website":null}` fails as
  "expected string", takes the honeypot branch, writes nothing, and answers
  "You are on the list". A real person told they joined when no row exists is
  the precise failure t-5 shipped the card inert to prevent, reintroduced by an
  over-eager trap.
- **Answering from the `catch`.** That block could not see the rate-limit
  headers, so only a genuine response carried `X-RateLimit-Remaining` — and
  header presence is a perfectly reliable tell for which field is the trap.

`undefined`, `null` and blank strings are what honest clients send and none of
them counts as filled. A non-string (a number, an object) does: the real form
cannot produce one.

## Reading it back — the admin surface

t-7 shipped the write and nothing that read it. A row nobody can see is
indistinguishable from a row that was never written (`HB9`) — including to
whoever wrote it, and including in review — so until t-8 landed, the only
evidence the public form worked was its own tests.

`/admin/app/waitlist` is the list, reached from a **"Lelañea"** section in the
admin sidebar registered by `lib/app/leaf-admin-nav.ts`. The page server-renders
the first page **through the API** rather than querying Prisma, which is the
platform's convention for an admin page and the API-first rule in `CLAUDE.md`: a
page that went straight to the database would be the one caller proving nothing
about the route.

The surface keeps Sunrise's admin chrome. `/admin/**` classifies as the `admin`
surface in `lib/app/surface.ts`, which `app/brand-theme.css` deliberately does
not reach, so the table uses `components/ui/*` rather than the brand kit even
though it lives in `components/app/`. **Ownership decides the tier, styling does
not** — `components/admin/` is Sunrise's.

The table shows what someone said, not just that they joined: `intent` is the
column it exists for. An answer over 240 characters is collapsed with a per-row
"Show all", because 25 answers of up to 2000 characters each renders as a wall
and a table whose rows are a screen tall is one nobody scans — and truncating
with no way back would hide the thing the row is for.

Three properties of the table are load-bearing and were all wrong in the first
version, each caught by the code review:

- **A stale response cannot land on a newer one.** Two requests are in flight
  whenever a search or a page change is dispatched while the previous one is still
  running — type `ada`, pause past the debounce, type `m` — and the ILIKE over
  `intent` has no index behind it, so the earlier query being the slower one is
  ordinary. Without a request-sequence guard the late response overwrites the
  rows, the pagination **and** the applied term, so the table shows the matches
  for `ada` while the box reads `adam` and the export link points at the wrong
  filter.
- **A failed load does not claim the list is empty.** The page's error banner does
  not stop the table underneath saying "Nobody has joined the waitlist yet", which
  is the one false statement this surface can make (`HB9`) on the one screen whose
  job is to answer that question. `initialLoadFailed` replaces the claim with a
  disclaimer, and the first successful fetch clears it without a reload.
- **The sort carries a unique tiebreaker.** `createdAt` is the transaction
  timestamp, so rows can tie; on a tie Postgres may order the page-1 and page-2
  queries differently, showing one entry twice and never showing another. `id`
  breaks it. The export has the same exposure at its `take` boundary, where a tie
  at the last row decides who is in the file.

`source` and `locale` are in the API and in the CSV but **not** columns in the
table. Both are provenance about the join rather than something to read, and
today both are near-constant: one write path, one locale. The export is where
you go for everything; the table is where you go to read.

One cosmetic to expect: the breadcrumb reads **Admin / app / waitlist**, because
`segmentLabels` in Sunrise's `components/admin/admin-header.tsx` is a hard-coded
map with no fork seam. Daybreak's own pages read the same way (`framework`,
lowercase), so this is platform-wide rather than ours, and not worth a divergence
row over a label.

### Two routes, not one with `?format=csv`

Both shapes exist in the platform — `approvals/history` takes the query
parameter, `conversations/export` takes the separate route. Taking away a file of
other people's addresses and stated intentions is a different **act** from paging
a table, not a different rendering of it, so they are separate: the bulk read
gets its own rate limit, its own log line and its own line in the security
review, and the list route keeps exactly one response shape.

`GET /api/v1/admin/app/waitlist` returns the platform's paginated envelope, 25 a
page, newest first, capped at 100. It is not sortable: the list is read as "who
joined recently, and what did they say", top to bottom.

`GET /api/v1/admin/app/waitlist/export` answers a `text/csv` attachment carrying
the same `q` filter, so the file matches what was on screen rather than quietly
containing everyone.

### Rate limiting, again in two layers

`proxy.ts` has already applied the **`admin` section tier** before either handler
runs — `RATE_LIMIT_POLICY` matches `/api/v1/admin/` as a prefix, so a new admin
route inherits the cap with no handler work at all. The export adds
`exportLimiter` on top (**10 a minute, keyed on the admin's own id**), because the
section cap alone would permit a hundred full-table downloads a minute and each
one is a complete copy of the list leaving the building. The list route adds
nothing: paging 25 rows is not the expensive act.

The key is **`export:waitlist:user:<id>`**, which deliberately departs from the
platform's convention. Sunrise's three other export routes all pass the literal
`export:user:<id>`, so they share one 10/min budget; a first version of this route
copied that string and inherited the sharing while its docblock claimed a per-flow
cap. Sharing is the wrong half to keep — ten waitlist exports would 429 the same
admin's own Art. 15 subject-access export at `/api/v1/users/me/export`, and a
burst of conversation exports would block this one for reasons invisible from
either screen. Same argument as `rate-limit.ts` makes for not borrowing
`contactLimiter`.

### The five things that make a CSV of strangers' answers safe

- **Every cell goes through `csvEscape()`** (`lib/api/csv.ts`), including the ones
  that look safe. `name`, `heardFrom` and `intent` are free text a stranger typed
  into a public form, and a value starting `=`, `+`, `-`, `@`, tab or CR is a
  formula to Excel, Calc and Sheets alike — on the machine of the one person who
  reads every one of these. `email` gets it too: `@` is a trigger character.
- **And through `csvCell()`, which closes the hole `csvEscape` leaves.** The
  platform helper quotes on `,`, `"` and `\n` — **not on a lone `\r`** — and checks
  the formula triggers only against a cell's FIRST character. Records here are
  joined with CRLF, so an unquoted `\r` mid-cell ends the record early and starts
  one whose first cell the submitter controls from its first character: exactly
  the position the trigger prefix exists to deny them. `.trim()` strips only the
  ends of a string, so `intent = "thanks!\r=cmd|' /C calc'!A0"` goes in through the
  public form and renders in the admin table as ordinary whitespace. `csvCell()`
  quotes on `\r` as well, which makes the CR data (RFC 4180 §2.6) and leaves the
  `=` mid-cell, where nothing evaluates it. Found by the security review of t-8.
  The defect is in Sunrise's `lib/api/csv.ts` — blob-identical in all three tiers
  — and `conversations/export` has the same exposure through message content.
  Filed as
  [`sunrise#768`](https://github.com/human-centric-engineering/sunrise/issues/768);
  drop `csvCell()` when that merges through.
- **A leading UTF-8 BOM.** Excel on Windows reads a BOM-less CSV as the system
  codepage, which turns a ñ into mojibake. The product's own name has one and so
  will many of the names on this list; `charset=utf-8` on the response does not
  reach a file opened from disk. Note that `response.text()` in a test **strips**
  it (`TextDecoder` defaults to `ignoreBOM: false`), so the assertion is on the
  bytes.
- **`Cache-Control: private, no-store`.** A raw `Response` skips
  `successResponse`'s `private, no-cache` default, and a response with no
  directive at all is one RFC 9111 §4.2.2 lets a shared cache store and expire on
  its own guess.
- **Nothing is logged but counts.** Not a row, and not the search term — the
  first thing anyone types into that box is somebody's address, and an address in
  an application log is a copy of their personal data outside the table the
  Art. 15 export and the Art. 17 erasure know how to reach. The log line carries
  `searched: true` instead.
- **And the logger drops the request URL, which is what made that true.** Leaving
  `q` out of the `meta` was not enough: `getRouteLogger` binds
  `url: request.url` — query string included — to every line it emits, and the
  sanitiser redacts by KEY name against `PII_FIELDS`, which lists `email` and not
  `url`. So the admin's own `email` context field was redacted in production
  while `?q=someone%40example.com` was written out beside it, to stdout and into
  the ring buffer `GET /api/v1/admin/logs` serves and greps. Both routes take
  their logger from `_shared/route-logger.ts`, which rebuilds the context without
  `url`; `endpoint` already carries the query-free path, so nothing operational
  is lost. Found by the security review of t-8, which caught the route docblock
  claiming the paragraph above while emitting the address. **The fix is narrow on
  purpose** — every other route in the app still logs its full URL, which is the
  platform's to change: [`sunrise#685`](https://github.com/human-centric-engineering/sunrise/issues/685).

### The export cap, and the remedy it ships with

`WAITLIST_EXPORT_MAX_ROWS` is 2000 — far above any realistic pre-launch list,
and there to bound memory, since `intent` is up to 2000 characters a row.

A cap introduces a state the system did not have before: a file that is silently
short. `HB10` says ship the remedy with it, so three things carry it. The
**filename** says `-first-2000` when it truncates, which is the one signal that
survives a plain browser download. The **page** shows the real total beside the
button, so "4,000 entries" next to a file named `…-first-2000.csv` reads as the
cap rather than as the whole list. And the remedy itself is the **search filter**:
narrow it and export again.

### Searching — where `mode: 'insensitive'` is fine, and why that is not a contradiction

The search is `contains` + `mode: 'insensitive'` over email, name, `heardFrom`
and `intent`. That is an `ILIKE`, and the section below says at length never to
use one — so the difference is worth stating rather than leaving as an apparent
inconsistency.

The hazard there is that an **equality** match silently widens into a wildcard
one, so a data subject's export reaches a stranger's row and their erasure
deletes it. Neither half transfers here: the caller is an admin already
authorised to read every row, so a wider match discloses nothing they could not
page to, and a substring search is **already** a wildcard match by construction,
so a `%` in the term behaving like one surprises nobody. What remains worth
bounding is cost, hence the 200-character cap on the term.

## Taking someone off the list

Someone writes in asking to be taken off. t-8 shipped the admin surface
read-only and t-24 closes that, because the alternative was a hand-written
database statement.

**It is a removal, not a deletion, and every line of this section depends on that
distinction.** `removedAt` is set, the row stays, and it still holds the person's
email, their name and what they said they wanted. Three consequences, all
deliberate:

- The **Art. 15 export still discloses a removed entry.** Art. 15 is about what we
  hold, and we hold it in full. `findWaitlistEntriesForSubject` has no `removedAt`
  clause, on purpose.
- The **Art. 17 erasure still deletes it.** `eraseWaitlistEntriesForUser` has no
  `removedAt` clause either. Adding one would leave every removed person's email
  in the database while reporting the erasure complete — and it would look like a
  sensible filter to whoever added it, which is why both sites say so in place and
  `tests/unit/lib/app/waitlist/privacy.test.ts` pins both.
- The column is **`removedAt`, never `deletedAt`.** Naming it after deletion is how
  a later reader concludes the erasure duty was met by a click in the admin.

The **confirmation dialog says this out loud** — "this does not delete their
data" — because the honest risk is not a misclick. It is an admin believing they
have answered a "delete my data" request.

### `PATCH`, not `DELETE`

One route (`/api/v1/admin/app/waitlist/[id]`) taking `{ removed: boolean }`, which
does both directions with one schema. `DELETE` is the obvious verb and the wrong
one: nothing is deleted, and on this surface that distinction decides a GDPR
answer, so a verb claiming a deletion is a verb that will eventually be read as
having performed one.

**The body is the state to REACH, not a toggle.** Two admins acting on the same
row in the same minute would otherwise leave it in whichever state arrived last,
and a double-clicked button would undo itself.

### A removed address that re-joins (D9, owner, 11 September 2026)

It **stays removed**, and the attempt is recorded in `rejoinRequestedAt` +
`rejoinRequests`, which the admin table shows as a badge on the row.

Clearing `removedAt` on a re-join is the obvious reading of "they submitted the
form, so they want to be on the list", and it is wrong for the same reason the
additive-write rule above exists: **nothing on the public route proves the
submitter owns the address.** With resurrect-on-rejoin, anyone who knows a
victim's address can undo that victim's own removal, repeatedly, and the victim
cannot tell. That is worse than the overwrite problem it resembles, because it
defeats a request the person actually made.

Staying removed **silently** was the third option and loses the honest case:
someone who removed themselves by mistake would have no way back, and no signal
would reach anyone. Recording the attempt keeps both properties — the removal
sticks, and "actually, please put me back" is visible to her.

The condition is enforced **in the WHERE** (`removedAt: { not: null }`), not in the
read that precedes it. A check-then-act version races a concurrent restore: the
row is live again by the time the write lands, and the counter goes up on someone
who is on the list. If that update matches nothing, the code falls through to the
ordinary additive fill — they were restored mid-flight, so their answers are
wanted. `removedAt: null` is likewise in the WHERE of all three fills, so an
answer cannot be written onto a row removed a moment earlier.

A restore does **not** clear `rejoinRequests`. Someone who asked to come back and
was then put back is exactly the person whose request should stay legible — it is
the record of why they are here again.

### Seeing them (D10, owner, 11 September 2026)

The list and the CSV exclude removed entries unless `includeRemoved=true`, which
the "Show removed" switch sets. Hidden completely, a soft delete is
indistinguishable from a hard one to the person using it — `HB9` again, which is
the defect this whole surface answers. A removed row renders struck through with a
**Removed** badge and a Restore button in place of Remove.

"Show removed" **widens** the population rather than narrowing it to the removed:
an admin who ticks the box is looking for context, not for a separate list. The
search still applies within whatever is shown, and the export carries both
filters so the file is always the screen.

### The CSV's three new columns are APPENDED

`removed_at`, `rejoin_requested_at`, `rejoin_requests` go at the end, never
inserted. Anything already consuming a file from t-8 reads by column position as
often as by name, so a new column in the middle silently shifts every field after
it.

## The two GDPR duties

Neither is optional and neither is automatic, because **the table is keyed by
email**. Everyone on it today joined before there was an account, so nothing
that matches on `userId` reaches them. This is the same case as core's
`ContactSubmission`, and the same reason no coverage guard could have found the
table for us.

### How a subject's own rows are matched — the line to be careful with

Both paths use `subjectMatch()`: `userId` **or** a **lower-cased exact** email.

**Never `{ equals, mode: 'insensitive' }`.** On the Prisma Postgres connector
that compiles to `ILIKE`, and Prisma does not escape the compared value — so
`_` and `%`, both legal in an email local part, become wildcards. Measured
against the development database:

```
equals 'john_doe@example.com' insensitive  ->  john_doe@…  AND  johnxdoe@…
equals 'a%@example.com'       insensitive  ->  a%@…        AND  ab@…
```

On the export that hands the subject a stranger's address, name and stated
intent. On the erasure it silently **deletes** that stranger's row, inside the
transaction, reporting only a larger `count`. Neither surfaces as an error.

The exact match is available because `email` is lower-cased on write, so only
the comparison side needs normalising — the subject's account address is
whatever they typed at signup. It is also the faster query: exact equality uses
the unique index, `ILIKE` cannot.

**Anything that writes this table must keep the address lower-cased**, or the
match starts silently missing rows — which on the erasure path means retaining
data after reporting it erased.

The clause came from core's `ContactSubmission` source
(`lib/privacy/export-sources.ts`), which is the only precedent in the manifest
for a table with no FK to `User` — and which still carries it. Filed as
[`sunrise#766`](https://github.com/human-centric-engineering/sunrise/issues/766):
export-only there, so it discloses a third party's submission rather than
deleting it, but the manifest invites forks to copy the shape and a fork that
copies it into an erasure hook gets the destructive version.

### Art. 15 — subject access

`lib/app/leaf-data-export.ts` declares `AppWaitlistEntry` → the `waitlist`
section, and its collector returns the rows `subjectMatch()` selects. Declaring
a section is a promise: `exportUserData()` throws if a declared section is
missing from what the collector returns, so the key is returned as an empty
array rather than omitted.

### Art. 17 — erasure

The `userId` column is a **plain scalar with no Prisma `@relation`** — a fork
table must not add a reverse field to Sunrise's `User`
([`CUSTOMIZATION.md` §5](../../CUSTOMIZATION.md)) — so the foreign key is
hand-written in the `app_waitlist_entry` migration with `ON DELETE SET NULL`.

**`SET NULL` is not the erasure policy on its own.** It keeps the row, holding
the person's email, name and answers, pointed at by nothing. So
`lib/app/leaf-bootstrap.ts` registers an erasure cleanup hook that **deletes**
the matching rows inside the erasure transaction, using the same
`subjectMatch()` as the export — reading the address from the transaction,
before `tx.user.delete()` removes the row it would have read it from. A throw there
rolls the whole erasure back, which is the right failure.

The FK action is the backstop for a row the hook cannot match, not the policy.

### The drift probe that keeps the FK alive

Prisma computes desired state from a schema that has no `@relation` for that
constraint, so **a future `migrate dev` will emit a `DROP` for it** — silently,
and already applied locally by the time anyone reads the generated SQL.
`lib/app/leaf-db-drift.ts` registers a probe pinning both its existence and its
`ON DELETE` action, and `npm run db:drift-check` (CI, `/pre-pr`) fails if either
moves. A constraint re-created with `NO ACTION` would pass an existence check
and break `prisma.user.delete()` with `P2003` for every user who had ever
joined.

**Author migrations on this table with `--create-only`, and apply them with
`npm run db:migrate:deploy`.** The schema and the database diverge here on
purpose, and `migrate dev` reads that divergence as drift and "corrects" it.

## Known gaps

- **There is no removal mechanism**, and the card no longer claims one. The
  prototype's closing line was "you can remove yourself in one click", which was
  decorative while the card was inert and became a false claim the moment it
  went live — that paragraph is the notice `consentedAt` records agreement to,
  and there is no unsubscribe route, no token, no email (A8) and no contact page
  (divergence row 7). It now reads "every email we send will have a one-click
  way off the list": true when it is read, and binding on whoever ships that
  email. Owner ruling, 10 September 2026.
- **`userId` is never written.** The column and its FK exist for the
  profile-seeding link, which is later work; nothing sets it today — so the admin
  table's "Account" column reads `—` for everyone, correctly and uninformatively,
  until that lands.
- **A removed row is kept indefinitely.** Removal takes someone off the list and
  keeps their email, name and answers for as long as the row exists, with no
  purpose that needs them — which is a storage-limitation problem (Art. 5(1)(e))
  rather than a bug. Nothing purges them today. The shape of the fix is a retention
  window and a scheduled purge (`.context/orchestration/retention.md` is the
  platform's precedent), and it is a task of its own rather than something to bolt
  onto a soft delete.
- **An admin still cannot EDIT an entry**, only remove and restore it. Correcting
  an answer on someone's behalf is the same unverified-write problem as the public
  route's, and the same signed confirmation link closes both.
- **An export leaves no durable audit row.** The record that a complete copy of
  the list was taken is the application log line, which rotates. The platform's
  audit log (`AiAuditLog`) records orchestration _config_ changes, so using it for
  a leaf table's bulk read would be a stretch rather than a fit; a subject-access
  regime that had to prove who exported what would need its own row.
- **An answer cannot be corrected through this route**, only added to, and a
  stranger can still seed an empty field — see above. A signed confirmation link
  would close both, and would also be what an ownership-proving unsubscribe
  needs.
- **Detecting the honeypot depends on an error's `details.errors[].path`
  string.** That is the platform's existing shape (`app/api/v1/contact/route.ts`
  does the same), and `tests/unit/lib/validations/app-waitlist.test.ts` pins the
  path name for exactly this reason — if it ever stopped being `website`, the
  route would quietly start returning a 400 that names the field.
- **`source: conversation` is vocabulary, not a shipped path.** See above.
