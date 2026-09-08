# Lelañea

**Lelañea** is an application built on the
[Daybreak](https://github.com/human-centric-engineering/daybreak) framework,
which is itself built on the
[Sunrise](https://github.com/human-centric-engineering/sunrise) platform.

> **Three tiers.** Sunrise is the platform (auth, API conventions, orchestration,
> security middleware). Daybreak is the framework on top of it (modules,
> facilitation maps, journeys, slots, guidance). Lelañea is the leaf — this repo,
> the product. Both tiers above are **upgradable dependencies**: we consume them,
> we don't edit them.
>
> Cut from **`daybreak-v0.2.0`** (Sunrise 0.11.2).

## Quick start

```bash
npm ci
cp .env.example .env.local     # then set DATABASE_URL, BETTER_AUTH_SECRET, the two URLs
npm run db:migrate:deploy      # applies all three tiers' migrations
npm run db:seed
npm run dev                    # binds :3014 (pinned in .env.development)
```

Then open **https://lelanea.test** — Lelañea is registered in the dev-proxy
(`~/Documents/Dev/dev-proxy`, slug `lelanea`), which serves that hostname to
`127.0.0.1:3014`. Use the proxied hostname rather than `localhost:3014`: both
reach the same server, but only the hostname matches `BETTER_AUTH_URL`, and auth
callbacks are checked against it. See
[`.context/app/local-dev.md`](./.context/app/local-dev.md).

Brand identity is **not** an environment variable — `NEXT_PUBLIC_APP_NAME` and
friends were removed in Sunrise 0.11.0 because they are inlined at build time and
never reached a container build. Lelañea's name lives in `lib/app/leaf-brand.ts`.

## Where our code goes

| Our code                                 | Goes in                                                |
| ---------------------------------------- | ------------------------------------------------------ |
| Pages                                    | a route group under `app/` (`(public)`, `(protected)`) |
| API endpoints                            | `app/api/v1/<resource>/`                               |
| React components                         | `components/app/`                                      |
| Business logic                           | `lib/`                                                 |
| Database models                          | `prisma/schema/app.prisma`, tables `@@map("app_…")`    |
| Registrations (boot, nav, export, brand) | the `lib/app/leaf-*.ts` seams                          |
| Environment variables                    | `lib/app/env.ts`                                       |
| Documentation                            | `.context/app/`                                        |

**Do not fill the four bridges** (`lib/app/bootstrap.ts`, `admin-nav.ts`,
`data-export.ts`, `brand.ts`) — those are Daybreak's. Fill the `leaf-*` file each
one delegates to. See
[`.context/framework/building-on-daybreak.md`](./.context/framework/building-on-daybreak.md).

## Syncing Daybreak

```bash
git fetch daybreak --tags
git merge daybreak-v0.3.0
```

Read [`.context/framework/CHANGELOG.md`](./.context/framework/CHANGELOG.md)
**before** merging. Never merge Sunrise directly, and never squash a sync PR —
both traps are explained in the `CLAUDE.md` banner and in
[`.context/app/syncing.md`](./.context/app/syncing.md).

## Documentation

- [`.context/app/`](./.context/app/) — **ours**
- [`.context/framework/`](./.context/framework/) — Daybreak's (read, don't edit)
- [`.context/`](./.context/) — Sunrise's platform substrate; start at
  [`substrate.md`](./.context/substrate.md)
- [`CLAUDE.md`](./CLAUDE.md) — tier rules, read the banner first

## Licence

MIT — see [`LICENSE`](./LICENSE).
