-- f-safety t-60 — the safety record also holds misuse attempts: an inline guard
-- flagging a message on one of her seats. Still never the words, only which
-- guard flagged and the mode it acted in.
--
-- Hand-written rather than generated, for the reason the t-58 migration gives:
-- a generated diff against this schema emits DROPs for every hand-written FK
-- and vector/full-text index Prisma cannot model (`B13`). These three
-- statements are the whole change.
--
-- `ADD VALUE` cannot run inside a transaction on older Postgres. Nothing below
-- uses the new value, so it is safe here on PG 12+.

-- AlterEnum
ALTER TYPE "app_safety_event_kind" ADD VALUE 'misuse';

-- AlterTable
ALTER TABLE "app_safety_event" ADD COLUMN "guard" TEXT,
ADD COLUMN "guardOutcome" TEXT;
