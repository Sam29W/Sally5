-- CreateTable
CREATE TABLE "cod_risk_configs" (
    "merchant_id" TEXT NOT NULL,
    "high_value_threshold_cents" INTEGER NOT NULL DEFAULT 500000,
    "low_address_quality_threshold" INTEGER NOT NULL DEFAULT 50,
    "risky_hour_start" INTEGER NOT NULL DEFAULT 0,
    "risky_hour_end" INTEGER NOT NULL DEFAULT 5,
    "velocity_threshold" INTEGER NOT NULL DEFAULT 3,
    "low_band_max" INTEGER NOT NULL DEFAULT 39,
    "medium_band_max" INTEGER NOT NULL DEFAULT 69,
    "high_rto_pincodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_pincodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_phone_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cod_risk_configs_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "cod_risk_decisions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "rule_version" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cod_risk_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_risk_outcomes" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cod_risk_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cod_risk_decisions_order_id_idx" ON "cod_risk_decisions"("order_id");

-- CreateIndex
CREATE INDEX "cod_risk_decisions_merchant_id_idx" ON "cod_risk_decisions"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cod_risk_outcomes_order_id_key" ON "cod_risk_outcomes"("order_id");

-- AddForeignKey
ALTER TABLE "cod_risk_configs" ADD CONSTRAINT "cod_risk_configs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_risk_decisions" ADD CONSTRAINT "cod_risk_decisions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_risk_outcomes" ADD CONSTRAINT "cod_risk_outcomes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
