-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_email" TEXT,
    "actor_api_key_prefix" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_merchant_id_created_at_idx" ON "audit_logs"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
