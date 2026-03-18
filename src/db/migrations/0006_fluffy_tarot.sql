ALTER TABLE "orders" ALTER COLUMN "crossmint_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "type" varchar(20) DEFAULT 'checkout' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "amount_pas" varchar(50);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "amount_usdc" varchar(50);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "polkadot_tx_hash" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_orders_polkadot_tx_hash" ON "orders" USING btree ("polkadot_tx_hash");