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
npm run dev          # binds :3014 — no -p needed, the port is committed
```

Then open **https://lelanea.test**, not `localhost:3014`. Both reach the same
server, but only the proxied hostname matches `BETTER_AUTH_URL`, and auth
callbacks are checked against it.

## The dev-proxy

Lelañea is registered in the dev-proxy at `~/code/dev-proxy` — slug
`lelanea`, port `3014` — which uses Laravel Herd to serve
`https://lelanea.test` → `127.0.0.1:3014` over a trusted local CA.

**Three places have to agree, and each is owned by someone different:**

| Setting                         | Lives in                       | Value                  |
| ------------------------------- | ------------------------------ | ---------------------- |
| the loopback port the app binds | `.env.development` (committed) | `PORT=3014`            |
| the hostname it is served on    | `.env.local` (gitignored)      | `https://lelanea.test` |
| the mapping between them        | `dev-proxy/apps.json`          | slug + port            |

Changing one alone does nothing useful: a new port without the registry means
nginx forwards to a dead socket; a new hostname without `.env.local` means auth
callbacks are rejected against the old one. `apply.sh` in the dev-proxy turns the
registry into Herd proxies.

### `npm start` binds 3000, not 3014

A production preview appears not to work on the test domain, and the reason is in
the table above. `npm start` resolves `nodeEnv: 'production'`, so
`scripts/dev-server.mjs` looks for `PORT` in `.env.production.local` →
`.env.local` → `.env.production` → `.env`. **`PORT=3014` is declared only in
`.env.development`**, which is not in that chain — so nothing matches, Next falls
back to its own default of 3000, and the proxy is still pointing `lelanea.test`
at 3014.

Stop `next dev` first — it holds the port — then:

```bash
PORT=3014 npm start        # a real env var outranks the env files
npm start -- -p 3014       # or the explicit-flag path
```

For something permanent on one machine, put `PORT=3014` in **`.env.local`**: it
is gitignored, it sits in _both_ chains, and it is the same value dev already
uses.

**Not `.env.production`.** It is gitignored like the rest of `.env*`, so this
is not about leaking it into git — `.gitignore`'s own comment records the
stronger reason: **Next's standalone build copies `.env.production` into the
build output**, so a port pinned there ships inside the production image. A real
deployment takes its port from the platform; 3014 baked into the image is a live
footgun bought for a local preview.

### When a production preview is worth the trouble

Rarely, and then decisively. §04 t-21 is the worked example: a React 19 console
error appeared on the shell's 404 page and nothing in dev could establish whether
it shipped. The warning string exists only in React's `.development.js` bundles
— but _reading bundles_ is an argument, and a clean console on
`https://lelanea.test/app/journey/typo` from a production build is a fact. It
became `sunrise#769` on the strength of the second, not the first.

**Why `lelanea.test` and not a subdomain of something shared:** the dev hostname
mirrors the _production site boundary_, not just the name. Lelañea has its own
production domain, so it gets its own registrable domain in dev too — which keeps
it cross-site from the other apps in dev exactly as it will be in production.
Nest apps that are siblings in production; keep apps that aren't, flat. Getting
this wrong makes dev _more permissive_ than production, so `SameSite=Lax` cookies
flow between apps that would be cross-site in prod and the bug stays invisible
until deploy. The dev-proxy README has the full rule.

## Environment

`.env.local` is gitignored. Only four variables are actually required by
`lib/env.ts`:

| Variable              | Note                                              |
| --------------------- | ------------------------------------------------- |
| `DATABASE_URL`        | our own database — **not** Daybreak's             |
| `BETTER_AUTH_URL`     | `https://lelanea.test` — the **proxied** hostname |
| `BETTER_AUTH_SECRET`  | ≥32 chars, **ours alone** (see below)             |
| `NEXT_PUBLIC_APP_URL` | `https://lelanea.test` — the **proxied** hostname |

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

- **Ports: already solved, and not by us.** The dev-proxy registry gives every
  app its own loopback port — Lelañea 3014, Sunrise's default 3010 — each pinned
  in that app's committed `.env.development`. Nothing collides and nothing needs
  a `-p` flag. That is precisely why the port is committed rather than left to
  whoever runs `npm run dev`.
- **Separate databases already.** Lelañea uses `hce-lelanea-dev`, Daybreak uses
  `hce-daybreak-dev`, both on the local Postgres. Nothing to do.
- **Docker is the one case still unhandled.** `docker-compose.yml` is
  Sunrise-owned and hardcodes `container_name: sunrise-dev` / `sunrise-db-dev`
  plus ports 3000 and 5432, so two checkouts running it at once will fight. Add a
  `docker-compose.override.yml` (a new file, so it never conflicts on a sync)
  remapping the names and published ports; Compose reads it automatically. The
  everyday `npm run dev` path does not go through Compose, so this only matters
  if you are exercising the container build.

`docker-compose.prod.yml` derives its project prefix from the directory name, so
a checkout in `lelanea/` already gets `lelanea-web` and `lelanea-db` without any
edit.
