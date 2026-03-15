import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crossmintUserId: varchar("crossmint_user_id", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    walletAddress: varchar("wallet_address", { length: 42 }),
    crossmintWalletId: varchar("crossmint_wallet_id", { length: 255 }),
    walletStatus: varchar("wallet_status", { length: 20 })
      .notNull()
      .default("none"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_users_crossmint_user_id").on(table.crossmintUserId),
    index("idx_users_email").on(table.email),
  ]
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type WalletStatus = "none" | "pending" | "active" | "failed"
