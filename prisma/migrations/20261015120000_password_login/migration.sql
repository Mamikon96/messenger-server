-- BE-44 (BE-D38): sign-in by login and password.
-- Migration 2 of 2 (migration 1 is 20261014120000_remove_passkeys_invites).
-- No data is migrated: the NOT NULL columns have no defaults, so existing users
-- cannot be converted. The guard below refuses to run on a non-empty table.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users") THEN
    RAISE EXCEPTION 'users is not empty: existing users cannot be converted to login/password accounts. Reset the dev database with `prisma migrate reset` and apply the migrations again.';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "login" TEXT NOT NULL,
  ADD COLUMN "password_hash" TEXT NOT NULL,
  ADD COLUMN "first_name" TEXT NOT NULL,
  ADD COLUMN "last_name" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "users_login_key" ON "users"("login");

-- Spec §4.1: login is normalized (trimmed, lower case) and matches [a-z0-9._-]{3,32}.
ALTER TABLE "users"
  ADD CONSTRAINT "users_login_format"
  CHECK ("login" = lower("login") AND "login" ~ '^[a-z0-9._-]{3,32}$');

-- name is derived by the code; the CHECK catches any writer that forgets to update it.
ALTER TABLE "users"
  ADD CONSTRAINT "users_name_matches_parts"
  CHECK ("name" = btrim("first_name" || ' ' || "last_name"));
