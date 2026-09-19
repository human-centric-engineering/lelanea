-- f-safety t-63 — AppCrisisCopy / AppCrisisRegion: the crisis resource, per
-- region, editable by an admin without a deploy.
--
-- Owner ruling, 19 Sept 2026: the resource lives in database tables, editable
-- per region. The bundled content/lelanea_crisis_resources.json stays in the
-- repo as the floor: lib/app/safety/resources-store.ts serves it whenever these
-- tables are unseeded, unreadable or slow, so a crisis turn never depends on
-- this read succeeding.
--
-- NO ROWS ARE WRITTEN HERE. prisma/seeds/app-lelanea/010-crisis-resources.ts
-- fills both tables from the JSON, once, only while `app_crisis_copy` is empty
-- (`fp4`: operator-owned, seed-if-absent). Until it runs the file is served.
--
-- Both tables hold nothing about anyone: who edited or signed off is in the
-- admin audit log. Declared as exclusions in lib/app/leaf-data-export.ts.
--
-- REVIEWED FOR SPURIOUS DROPS (`B13`). The generated diff also dropped every
-- hand-written foreign key on app_* and framework_* tables, the vector and
-- full-text indexes, and the searchVector default — none of which Prisma's
-- schema can express. All stripped; only the three statements below remain.

-- CreateEnum
CREATE TYPE "app_crisis_content_status" AS ENUM ('draft', 'signed_off');

-- CreateTable
CREATE TABLE "app_crisis_copy" (
    "slug" TEXT NOT NULL DEFAULT 'global',
    "hardIntro" TEXT NOT NULL,
    "softIntro" TEXT NOT NULL,
    "emergency" TEXT NOT NULL,
    "keptMessage" TEXT NOT NULL,
    "internationalName" TEXT NOT NULL,
    "internationalContact" TEXT NOT NULL,
    "internationalUrl" TEXT NOT NULL,
    "internationalHours" TEXT NOT NULL,
    "status" "app_crisis_content_status" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "signedOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_crisis_copy_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "app_crisis_region" (
    "region" TEXT NOT NULL,
    "emergencyNumber" TEXT NOT NULL,
    "services" JSONB NOT NULL,
    "status" "app_crisis_content_status" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "signedOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_crisis_region_pkey" PRIMARY KEY ("region")
);
