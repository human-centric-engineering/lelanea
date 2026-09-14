---
name: app-gateway
description: The gate in front of the shell — the acknowledgement ledger, its API, and what re-gates.
---

# The gateway

Nobody reaches the shell without acknowledging the Disclaimer and the Terms of
Use and confirming they are eighteen or over (§06). This doc covers the
**ledger** and its API (t-15). The gate page and the layout redirect that read
it are t-16 and will be added here when they land; data rights are t-17.

## The pieces

| Piece                                     | Path                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| Model + enum                              | `prisma/schema/app.prisma` — `AppAcknowledgement`          |
| Migration (hand-written FK, see below)    | `prisma/migrations/20260914121123_app_acknowledgement/`    |
| Ledger module — required versions, status | `lib/app/gateway/acknowledgements.ts`                      |
| Validation                                | `lib/validations/app-acknowledgement.ts`                   |
| Routes                                    | `app/api/v1/app/acknowledgements/route.ts` (`GET`, `POST`) |
| Art. 15 declaration + collector           | `lib/app/leaf-data-export.ts` — section `acknowledgements` |
| Art. 17 — the cascade, pinned             | `lib/app/leaf-db-drift.ts`                                 |

## The model, and the one rule it encodes

One row is one acknowledgement: `userId`, `kind`, `documentVersion`,
`acknowledgedAt`. Three kinds:

| Kind         | Stands for                          | `documentVersion` is                              |
| ------------ | ----------------------------------- | ------------------------------------------------- |
| `disclaimer` | the `disclaimer` document           | the foundational collection's `version` (`1.1`)   |
| `terms`      | the `terms_of_use` document         | the same collection version                       |
| `age_18`     | the eighteen-plus confirmation (A7) | `AGE_18_VERSION`, a constant naming the threshold |

**A kind is satisfied by a row at the version required _now_, not by ever
having been acknowledged.** `getRequiredVersions()` reads the collection version
from the content loader on every call, and `getGateStatus(userId)` matches rows
against it. So bumping `collection.version` in
`content/lelanea_foundational_documents.json` re-gates both documents for
everyone by construction — nothing in this module has to notice — while the
age confirmation stands, because its constant did not move. The superseded rows
stay: they are the record of what was agreed before, and the export returns
them.

The two documents share one version because they are versioned together, by
their author, in one file. If they ever need independent versions, that is a
change to the content schema first and this module second.

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
