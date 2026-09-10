---
name: waitlist
description: The public waitlist — the model, the route, and the two GDPR duties that come with keeping someone's answers.
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

`POST /api/v1/app/waitlist` answers **201** on a first join and **200** on a
repeat, with **the same body either way**. That is deliberate: a different
message for "already on the list" would let anyone ask the endpoint whether a
given address had signed up.

**A repeat updates rather than conflicting**, and a **blank optional field on a
repeat leaves the stored answer alone.** The form always renders empty, so a
returning visitor re-submitting just their email — because they are not sure the
first one landed — must not silently lose the paragraph they wrote the first
time. They cannot see the stored value, so they could never know it had gone.
Only a value actually typed overwrites one; the create path still writes `NULL`
for a blank, where there is nothing to preserve.

`consentedAt` moves on a repeat and `createdAt` does not: when they first asked
and when they most recently agreed to the notice are different facts.

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
that rejected it would tell the bot which field it is. A filled honeypot gets a
200 and the same sentence as a real join, and writes nothing. So does a
honeypot that fails _validation_, which would otherwise return a 400 naming the
field.

## The two GDPR duties

Neither is optional and neither is automatic, because **the table is keyed by
email**. Everyone on it today joined before there was an account, so nothing
that matches on `userId` reaches them. This is the same case as core's
`ContactSubmission`, and the same reason no coverage guard could have found the
table for us.

### Art. 15 — subject access

`lib/app/leaf-data-export.ts` declares `AppWaitlistEntry` → the `waitlist`
section, and its collector returns the rows matched on **email or `userId`**,
case-insensitively. Declaring a section is a promise: `exportUserData()` throws
if a declared section is missing from what the collector returns, so the key is
returned as an empty array rather than omitted.

### Art. 17 — erasure

The `userId` column is a **plain scalar with no Prisma `@relation`** — a fork
table must not add a reverse field to Sunrise's `User`
([`CUSTOMIZATION.md` §5](../../CUSTOMIZATION.md)) — so the foreign key is
hand-written in the `app_waitlist_entry` migration with `ON DELETE SET NULL`.

**`SET NULL` is not the erasure policy on its own.** It keeps the row, holding
the person's email, name and answers, pointed at by nothing. So
`lib/app/leaf-bootstrap.ts` registers an erasure cleanup hook that **deletes**
the matching rows inside the erasure transaction, matching on `userId` _and_ on
the subject's email — which it reads from the transaction, before
`tx.user.delete()` removes the row it would have read it from. A throw there
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

- **"You can remove yourself in one click" is a promise with nothing behind it
  yet.** The card's closing sentence is the prototype's, and it is forward-
  looking — the first waitlist email is where a one-click removal would live,
  and A8 defers that email. Whatever ships that email owes the link.
- **`userId` is never written.** The column and its FK exist for the
  profile-seeding link, which is later work; nothing sets it today.
- **`source: conversation` is vocabulary, not a shipped path.** See above.
