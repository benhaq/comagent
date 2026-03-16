import { relations } from "drizzle-orm"
import { users } from "./users"
import { chatSessions } from "./chat-sessions"
import { chatMessages } from "./chat-messages"

export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
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
