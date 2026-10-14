-- BE-33 (BE-D38): remove passkey sign-in, WebAuthn challenges and invites.
-- Migration 1 of 2: password columns are added by BE-44.
-- Irreversible: passkey, challenge and invite data is dropped (no real users, BE-D35).

-- DropTable (dependants first: challenges reference invites and users)
DROP TABLE "webauthn_challenges";
DROP TABLE "passkeys";
DROP TABLE "invites";

-- DropEnum
DROP TYPE "InviteKind";

-- DropIndex
DROP INDEX "users_webauthn_user_id_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "webauthn_user_id";
