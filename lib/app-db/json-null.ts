/**
 * Prisma's database null, for Lelañea's services (f-content-seeds t-91).
 *
 * A nullable `Json` column cannot be cleared by writing `null` through the
 * client: there `null` is refused at the type level, and `undefined` on an
 * update means "leave it". Clearing one needs `Prisma.DbNull`, which is a VALUE
 * import of `@prisma/client`, and `lib/app/**` may import Prisma for types only
 * (the ESLint boundary in `eslint.config.mjs`: "DB access goes through app/
 * route handlers or lib/ services"). This file is that lib/ service, and the
 * smallest one there could be.
 *
 * Leaf-owned: nothing upstream has a `lib/app-db/` folder.
 */

import { Prisma } from '@prisma/client';

/** SQL NULL for a nullable `Json` column: what the seed leaves when it writes no value. */
export const DB_NULL = Prisma.DbNull;
