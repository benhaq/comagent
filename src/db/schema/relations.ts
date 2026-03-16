import { relations } from "drizzle-orm"
import { users } from "./users"
import { chatSessions } from "./chat-sessions"
import { chatMessages } from "./chat-messages"
import { orders } from "./orders"

export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
  orders: many(orders),
}))

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  messages: many(chatMessages),
}))

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}))

export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
}))
