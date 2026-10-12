-- Замена OAuth и allowlist на passkeys и инвайты (BE-21): данных нет, таблица allowlist, колонки provider и enum Provider удаляются.

-- CreateEnum
CREATE TYPE "InviteKind" AS ENUM ('join', 'recovery');

-- DropForeignKey
ALTER TABLE "allowlist" DROP CONSTRAINT "allowlist_added_by_fkey";

-- DropForeignKey
ALTER TABLE "allowlist" DROP CONSTRAINT "allowlist_user_id_fkey";

-- DropIndex
DROP INDEX "users_provider_provider_user_id_key";

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "provider",
DROP COLUMN "provider_user_id",
ADD COLUMN     "disabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "webauthn_user_id" BYTEA NOT NULL;

-- DropTable
DROP TABLE "allowlist";

-- DropEnum
DROP TYPE "Provider";

-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL,
    "transports" TEXT[],
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" "InviteKind" NOT NULL,
    "user_id" UUID,
    "make_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "used_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_challenges" (
    "id" UUID NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "invite_id" UUID,
    "user_id" UUID,
    "webauthn_user_id" BYTEA,
    "name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "webauthn_challenges_expires_at_idx" ON "webauthn_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_webauthn_user_id_key" ON "users"("webauthn_user_id");

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddCheckConstraint
ALTER TABLE "invites" ADD CONSTRAINT "invites_kind_target" CHECK (("kind" = 'recovery') = ("user_id" IS NOT NULL));

-- AddCheckConstraint
ALTER TABLE "invites" ADD CONSTRAINT "invites_recovery_not_admin" CHECK (NOT ("kind" = 'recovery' AND "make_admin"));

-- AddCheckConstraint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_purpose" CHECK ("purpose" IN ('register', 'login', 'add_passkey'));

-- AddCheckConstraint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_device_type" CHECK ("device_type" IN ('singleDevice', 'multiDevice'));
