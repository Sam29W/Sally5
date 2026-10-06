-- CreateTable
CREATE TABLE "shopify_shops" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),

    CONSTRAINT "shopify_shops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopify_shops_shop_domain_key" ON "shopify_shops"("shop_domain");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_shops_merchant_id_key" ON "shopify_shops"("merchant_id");

-- AddForeignKey
ALTER TABLE "shopify_shops" ADD CONSTRAINT "shopify_shops_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
