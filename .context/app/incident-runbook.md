---
name: app-incident-runbook
description: What whoever is on call does when something goes wrong with a real person's data or safety — who owns it, how bad it is, the containment levers that exist (each with the page or command), the GDPR 72-hour clock, the crisis path failing, a cost runaway, and the defined response to repeated abusive use.
---

# Incident runbook

f-safety t-62; product description §8.5, §8.6. The GDPR clock for a personal-data
breach starts when we become **aware** of it, not when it is convenient. A
runbook that is only written once it is needed gets written in a hurry by the
person least able to write it. This page is the rehearsed version.

**Every lever below was checked against the tree when this page was written.**
If one no longer answers where it says, fix this page before anything else.

## Who

| Role   | Name                                 | Reaches by |
| ------ | ------------------------------------ | ---------- |
| Owner  | _to be named by the owner in review_ |            |
| Deputy | _to be named by the owner in review_ |            |

- **The owner runs the incident**, decides its severity, and makes or signs off
  every notification. The deputy does all of that when the owner can't be reached
  within an hour.
- **Whoever notices first starts the clock.** Write down the time you became
  aware, and then contain. You don't need anyone's permission to pull a
  containment lever. Each one can be undone, except rotating a secret.
- **Admin access is required** for every page named here: `/admin/**` is
  `withAdminAuth`.

## Severity

| Level  | Means                                                                                                | Examples                                                                                                            | Response                                         |
| ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **S1** | A person may be at risk, **or** personal data has reached, or may have reached, someone it shouldn't | the crisis path not showing the resource · one member's conversation readable by another · a leaked database or key | now, any hour · the 72-hour clock may be running |
| **S2** | Harm is plausible but not happening yet, or money is leaving fast                                    | a cost runaway · her replying out of role or as a therapist in a live conversation · repeated abusive use           | same day                                         |
| **S3** | Degraded, not harmful                                                                                | provider outage (turns end `unavailable`) · a helpline number that has changed but still redirects                  | next working day                                 |

When in doubt, choose the higher level. You can lower it once you know more.

## First ten minutes

1. **Note the time you became aware.** For a personal-data breach, that time
   starts the 72-hour clock.
2. **Contain** with the lever from the table below that stops the harm. Don't stop
   to diagnose first.
3. **Tell the owner** (or the deputy).
4. **Start the incident log**: a private note of times, what was seen, what was
   done, and by whom. It becomes the breach record (see [the 72-hour
   clock](#the-72-hour-clock)). **Put no conversation text and no crisis wording
   in it.** Refer to people by user id.

## Containment levers

Each lever names what it does, where it is, and what it does **not** do.

### Pause every conversation with her

**`/admin/features` → `LELANEA_GENERATION_PAUSED` → on.** On both of her seats,
every turn gets the `paused` ending **before** anything is claimed or any model
is called. No turn row and no cost row are written. The change applies from the
next turn, with no deploy.

- **The crisis path still works.** The crisis check runs ahead of the pause, and
  while paused it calls no model: the context check counts as unavailable and
  the hit stays hard. A person in danger still gets the resource.
- **Everything readable stays readable.** Content, the journey map and replays
  of completed turns are still served (`reading-survives.test.ts`).
- **It pauses her seats only.** Knowledge ingestion, workflows, admin chat and
  the platform's own agents keep calling models. To stop those, see [Cost
  runaway](#cost-runaway).
- **Undo:** switch it off. A turn the person retries under the same id then runs.
- Created off by seed `008`, and a re-seed never writes it again. **If the flag
  is missing, there is no pause** (a missing flag reads as not paused). Create it
  at `/admin/features` → create, with the key `LELANEA_GENERATION_PAUSED`, set to
  on. Don't rely on `npm run db:seed` to put it back: the runner skips a unit it
  has already applied, so a flag deleted after seeding stays deleted.

Details: [`agent.md` → The pause switch](./agent.md#the-pause-switch).

### Take her off a seat

**`/admin/orchestration/agents` → her agent (`lelanea-guide`) → Active off.**
An inactive agent gives no facilitation surface (`resolveFacilitationSurface`),
so both of her seats answer **404**. Setting her visibility to anything other than
`public` has the same effect.

- **Prefer the pause.** A 404 ends a conversation silently. The pause tells the
  person, in plain words, what happened. Take her off a seat only when she must
  not be reachable at all: her agent compromised, or her prompt or tools
  changed by someone who shouldn't have.
- **Unbinding one seat only** is API-only. Read the binding id from
  `GET /api/v1/admin/framework/facilitation/agents`, then
  `DELETE /api/v1/admin/framework/facilitation/agents/:bindingId`. **The next
  re-seed binds her again** (seed `006` fills empty seats). To keep her off a seat
  for good, remove the role from `SEATED_ROLES` (`lib/app/agent/pins.ts`) and
  deploy.
- **She has no other door.** Sunrise's consumer chat route refuses her slug
  (divergences Row 21). **Never make her a module's primary agent**: Daybreak's
  module chat route would reach her without the turn hook, so without the crisis
  check or the ceiling ([`agent.md`](./agent.md#where-else-she-can-be-reached)).

### Rotate a provider key

Her model is OpenAI's (`PINNED_PROVIDER`, `lib/app/agent/pinned-model.ts`). The
provider row at `/admin/orchestration/providers` stores only the **name** of the
environment variable. The key itself lives only in the host's environment
(`OPENAI_API_KEY`; the others appear on the same page).

1. Create a new key in the provider's console.
2. Set it in the host's environment and redeploy (or restart), so every instance
   reads it.
3. **Then revoke the old key in the provider's console.** Revoking first leaves
   every turn failing as `unavailable` until the new key is live.
4. Confirm with one turn on her seat, then `GET /api/v1/app/agent/status`, which
   should read `available`.

The same steps apply to `RESEND_API_KEY` (email). **`BETTER_AUTH_SECRET` is a
bigger change**, so rotate it only when the secret itself has leaked, or when a
sign-out has to take effect at once (see below). It signs everyone out. It
also breaks, without warning, everything else it signs:

- approval links still waiting (`lib/orchestration/approval-tokens.ts`)
- signed storage links (`lib/storage/access-tokens.ts`)
- email-change confirmations (`lib/auth/change-email.ts`)
- visitor ids (`lib/logging/visitor-id.ts`)

### Revoke a person's sessions

**There is no admin page or route for this.** `revokeUserSessions()`
(`lib/auth/sessions.ts`) exists, but only the email-change flow calls it. From a
database console on the affected database:

```sql
-- one person, every device
DELETE FROM "session" WHERE "userId" = '<user id>';
-- everyone (a leaked session store, a compromised admin)
DELETE FROM "session";
```

**It takes up to five minutes.** Sessions are cached in a signed cookie for 5
minutes (`cookieCache`, `lib/auth/config.ts`), and the auth guards read that
cookie. A browser with a fresh one stays signed in, **with the role it had when
it was cached**, until the cookie expires. Log the containment time as the
deletion plus five minutes. If it has to take effect at once (an attacker holding
an admin session), also rotate `BETTER_AUTH_SECRET`.

Deleting the sessions does **not** stop them signing back in. If the password
is compromised, have it reset **first**, then delete the sessions: a password
reset doesn't revoke sessions in this configuration. **An admin's account:**
demote it at `/admin/users/:id/edit` (role → user) before either step.

### Revoke an API key

- **A member's own key:** `DELETE /api/v1/user/api-keys/:keyId` is theirs to call
  (browser session only). For an admin, run
  `UPDATE ai_api_key SET "revokedAt" = now() WHERE id = '<key id>';` directly.
  A revoked key is refused on its next request.
- **An MCP key:** `/admin/orchestration/mcp/keys`.
- **Everything else** is in the host's environment: see [Rotate a provider
  key](#rotate-a-provider-key).

### Stop one person's spending

**`/admin/app/agent` (Lelañea → Deadlines & budgets) → the person → limit `0`.**
Every turn they start then ends on `ceiling_reached`, before any model call.
**Clear** the limit (it deletes the row) to go back to the default.

- **The crisis path is never behind it.** A person over their limit who writes
  that they are in danger still gets the resource.
- **It fails open.** If the month's spend can't be read (a database problem),
  the turn is allowed, and a warning is logged
  (`Monthly ceiling could not be read; the turn is allowed`). So a `0` limit is
  not a hard stop. Where one is needed, use the pause or take her off a seat.
- **The member-facing copy is written for a monthly limit.** It says replies come
  back on the reset date. For a person you have stopped on purpose, that is not
  true. See [Repeated abusive use](#repeated-abusive-use).

## The 72-hour clock

For a **personal-data breach**: personal data lost, altered, disclosed, or
reached by someone it shouldn't have been. That includes an incident where you
can't yet rule it out.

| When                | Who             | Does                                                                                                                                                                                                                         |
| ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On awareness (T+0)  | whoever noticed | notes the time, contains, tells the owner                                                                                                                                                                                    |
| By T+24h            | owner           | decides whether this is a breach, and whether it is **likely to risk** people's rights. Records the decision **and the reasoning either way**                                                                                |
| **By T+72h**        | owner           | if there is a risk: notifies the **supervisory authority** (the controller's lead authority; the ICO for a UK controller). Send what is known; follow up with the rest. Report late, with the reason, rather than not at all |
| Without undue delay | owner           | if the risk is **high**: tells the people affected directly, in plain words — what happened, what it means for them, what we have done, what they can do                                                                     |
| Always              | owner           | keeps the breach record (the incident log): facts, effects, remedial action. It is kept even when nothing is reported                                                                                                        |

**What is personal data here.** Every account, the waitlist, and everything a
member wrote. **`app_safety_event` rows are special-category data** (they record
that someone showed signs of crisis), even though they hold no words. Treat any
exposure of them as high risk.

**Who is affected.** GDPR Art. 15 export (`exportUserData()`) is the manifest of
what we hold about one person. Use the source list
(`lib/privacy/export-sources.ts` and `lib/app/leaf-data-export.ts`) to work out
which tables a leak touched.

## The crisis path failing

The crisis path answers before the model, and the model has no part in whether
it works. So a failure here is ours, and it is **S1**.

| Symptom                                                                | Likely cause                                                                                                                 | Do                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crisis language in a turn shows no resource, and no turns are recorded | the server booted without the turn hook, so every turn skips it                                                              | `npm run smoke:app-turn` says so directly. Redeploy. **Pause** until it passes                                                                                                                              |
| One phrase is missed                                                   | the phrase list doesn't match that wording                                                                                   | add the wording as a case in `tests/unit/lib/app/safety/detect.test.ts` **first**, then the pattern in `lib/app/safety/detect.ts`. Ship it as a fix the same day                                            |
| A helpline number has stopped answering, or its details changed        | the authored resource is out of date                                                                                         | edit `content/lelanea_crisis_resources.json`, then have Lelañea sign off the change. While it waits: remove the service (every region keeps at least one, and the international directory is always listed) |
| The resource shows, but no event row                                   | the record write failed. It is logged at `error` (`Crisis event record write failed`), and the person still got the resource | the path worked. Fix the write. The missing rows cannot be rebuilt: the log line carries the same fields minus the person                                                                                   |
| A turn reached her with no crisis check at all                         | another door was opened: a module's primary agent, or an unsafe route                                                        | **take her off** that door. See [Take her off a seat](#take-her-off-a-seat)                                                                                                                                 |

**Rehearsal:** `npm run smoke:app-crisis`. It runs with every `*_API_KEY`
removed, and proves a hard hit gets the UK resource with no model call. A
malformed resource file fails `tests/unit/lib/app/safety/resource.test.ts`,
which reads the real file, so it cannot pass CI.

**Remember what the path is:** a named place to turn. It is not a response team,
and nobody is paged when it fires. The `app_safety_event` rows are for **seeing
that the path works**. They are not a queue anyone watches for individuals.

## Cost runaway

Three limits, from narrowest to widest:

| Lever                      | Where                                                      | Effect                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One person's limit         | `/admin/app/agent`                                         | `ceiling_reached` before their next turn                                                                                                                                                                                 |
| Her agent's monthly budget | `/admin/orchestration/agents` → her agent → monthly budget | the platform refuses her turns once spend passes it; members see `unavailable`                                                                                                                                           |
| **Global monthly budget**  | `/admin/orchestration/settings` → global monthly budget    | every agent's chat turns stop once the install's combined month-to-date spend reaches it — admin chat and the platform's agents too. Enforced in the chat handler only, so ingestion and workflows are not stopped by it |

Plus the **pause** for her seats, and a **spend limit set in the provider's
console**. The provider's limit is the only one that stops every call, and the
only one that holds if our own metering is wrong.

**Find the source** with `GET /api/v1/admin/app/metering?by=user` (also
`by=seat`, `model`, `day`, `conversation`), and see `/admin/orchestration/costs`.
**User-less spend is platform cost** (ingestion, workflows): if `platformCostUsd`
is the one climbing, the cause isn't a member.

**Known overshoot:** each turn is checked before it runs, never during. So a
person with several turns in flight at once can pass their limit by one turn's
cost per turn in flight ([`agent.md` → The monthly
limit](./agent.md#the-monthly-limit)).

## Repeated abusive use

§8.6 asks for "a defined response rather than an ad-hoc one". This is it:
_proposed here, confirmed by the owner in review_.

### What is recorded, and who reads it

When the input guard flags a message on either of her seats (prompt injection,
role override, prompt extraction), two things are written. Her guards are set to
`log_only`, so the person is never blocked, and no text is kept:

1. **An `app_safety_event` row**, `kind = 'misuse'`, with the user id, seat and
   guard. It holds no words.
2. **An audit entry**, `facilitation_escalation.triggered` (seed `009`'s
   escalation policy, `medium` priority). Read it at
   **`/admin/orchestration/audit-log`**, searching `facilitation_escalation`.
   The affected user id is in its metadata.

**The email notification only goes out if two things are configured, and neither
is today:**

- **escalation recipients**, notifying on `all` or `medium and above`, at
  `/admin/orchestration/settings` → escalation
- **`RESEND_API_KEY`** in the environment

Until both are set, **nobody is notified**: the audit log only helps someone who
reads it. The owner or deputy should read it **weekly**, and set up the
recipients before the first real member reaches the gate.

To count attempts per person, run this on a database console:

```sql
SELECT "userId", count(*) AS attempts, min("createdAt"), max("createdAt")
FROM app_safety_event
WHERE kind = 'misuse' AND "createdAt" > now() - interval '30 days'
GROUP BY "userId" ORDER BY attempts DESC;
```

**A flag is not proof of abuse.** The input guard is regex-based. Someone
pasting an article about prompts, or writing "ignore what I said before", can be
flagged. **Nothing in the record says what they wrote, by design**, so you
can't judge a flag by reading the conversation. Reading a member's conversation
needs their consent at the time, and is logged (§8.3, §12).

### The ladder

| Pattern (30 days)                                                | Response                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–4 flags                                                        | nothing. Her refusals handled it                                                                                                                                                                                    |
| 5 or more, or a burst (5 in a day)                               | **S2.** The owner looks at the pattern (seats, times, spend) — never the words — and notes it in the incident log                                                                                                   |
| Continues after that, or comes with a cost spike                 | the owner **writes to the person**, from a monitored address. Plain words: what we saw (the count, not the content) and what the app is for. Set their limit to `0` at `/admin/app/agent` while waiting for a reply |
| Continues after being written to, or causes harm to someone else | the owner decides whether to **end the account** under the Terms. Offer the export first (`GET /api/v1/users/:id/export`), then delete it from the list at `/admin/users` (`eraseUser()`)                           |

**A $0 limit is a stopgap, not a suspension.** The person still signs in and
reads, and the copy they see says replies come back at the start of next month.
**There is no suspend-an-account mechanism** that tells the person the truth (B31).
If the ladder's third rung is used for real, that is the trigger to build one.

## After an incident

- **Undo each lever you pulled**, and confirm with `GET /api/v1/app/agent/status`
  (`available`) or the smoke for the part affected.
- **If people saw an outage, say so.** §8.1: incidents are disclosed rather than
  hidden. The status read drives the banner.
- **Raise a bug on the board** against the feature that caused it (Q3: the one
  you'd revert). If the fix is in a file another tier owns, file it with that tier
  (see the `CLAUDE.md` banner).
- **Update this page** with anything it got wrong. A runbook that was wrong once
  and never corrected will be wrong the same way next time.

## Known gaps

Recorded so they are not rediscovered mid-incident:

- **No admin page to revoke sessions**, and no account suspension (see above).
- **No stated backup recovery point, and no tested restore** (§8.5). Restoring
  depends on the database host's own backups, and nothing here says how recent
  they are.
- **Escalation notifications are not configured** (no recipients, no email key).
