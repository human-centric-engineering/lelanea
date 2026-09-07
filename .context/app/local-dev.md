---
name: local-dev
description: Running Lelañea locally, including alongside a Daybreak checkout.
parent: README.md
---

# Local development

```bash
npm ci
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

## Environment

`.env.local` is gitignored. Only four variables are actually required by
`lib/env.ts`:

| Variable              | Note                                  |
| --------------------- | ------------------------------------- |
| `DATABASE_URL`        | our own database — **not** Daybreak's |
| `BETTER_AUTH_URL`     | `http://localhost:3000`               |
| `BETTER_AUTH_SECRET`  | ≥32 chars, **ours alone** (see below) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000`               |

**Do not share `BETTER_AUTH_SECRET` with another app.** It is the session signing
key; two apps sharing one means a session minted by either is accepted by both.
Generate a fresh one per repo:

```bash
openssl rand -base64 32
```

**Brand identity is not an environment variable.** `NEXT_PUBLIC_APP_NAME`,
`NEXT_PUBLIC_LEGAL_NAME` and `NEXT_PUBLIC_APP_DESCRIPTION` were removed in
Sunrise 0.11.0: `NEXT_PUBLIC_*` is inlined at build time and `.dockerignore`
excludes `.env*`, so a container build delivered none of them and shipped the
wrong name in both footers. Ours lives in `lib/app/leaf-brand.ts`. A boot warning
names any of the three left set.

Provider keys (OpenAI, Resend, Google OAuth) are deliberately **not** inherited
from Daybreak — add Lelañea's own when a feature first needs one.

## Running alongside a Daybreak checkout

Both repos ship the same Sunrise-owned `docker-compose.yml`, which hardcodes
`container_name: sunrise-dev` / `sunrise-db-dev` and publishes ports 3000 and 5432. **We deliberately do not edit that file** — it is Sunrise-owned, Daybreak
left it alone too, and changing it buys a merge conflict on every sync for a
cosmetic gain.

So if you need both running at once:

- **Separate databases already.** Lelañea uses `hce-lelanea-dev`, Daybreak uses
  `hce-daybreak-dev`, both on the local Postgres. Nothing to do.
- **The dev server:** `PORT=3001 npm run dev`, and set `BETTER_AUTH_URL` /
  `NEXT_PUBLIC_APP_URL` to match, or the auth callbacks land on the wrong app.
- **Docker:** add a `docker-compose.override.yml` (a new file, so it never
  conflicts) remapping `container_name` and the published ports. Compose reads it
  automatically.

`docker-compose.prod.yml` derives its project prefix from the directory name, so
a checkout in `lelanea/` already gets `lelanea-web` and `lelanea-db` without any
edit.
