-- AlterTable
ALTER TABLE "allowlist" ADD COLUMN "user_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "allowlist_user_id_key" ON "allowlist"("user_id");

-- AddForeignKey
ALTER TABLE "allowlist" ADD CONSTRAINT "allowlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
