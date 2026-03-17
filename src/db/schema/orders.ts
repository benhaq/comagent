import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { users } from "./users"

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    crossmintOrderId: varchar("crossmint_order_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_orders_user_id").on(table.userId),
    uniqueIndex("idx_orders_crossmint_order_id").on(table.crossmintOrderId),
  ]
)

export type Order = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
