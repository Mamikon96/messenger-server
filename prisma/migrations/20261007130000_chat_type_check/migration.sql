-- AddCheckConstraint
ALTER TABLE "chats" ADD CONSTRAINT "chats_type_shape" CHECK (
    ("type" = 'direct' AND "direct_key" IS NOT NULL AND "title" IS NULL)
    OR ("type" = 'group' AND "direct_key" IS NULL AND "title" IS NOT NULL)
);
