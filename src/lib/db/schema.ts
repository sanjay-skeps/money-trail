import { sql } from "drizzle-orm";
import {
  pgTable, text, timestamp, uuid, varchar, numeric, date, index, boolean,
  integer, smallint, uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // cash, bank, wallet, investment, credit_card
  kind: varchar("kind", { length: 12 }).notNull().default("asset"),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ userIdx: index("accounts_user_idx").on(t.userId) }));

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 60 }).notNull(),
  type: varchar("type", { length: 12 }).notNull().default("expense"),
  parentId: uuid("parent_id"),
  icon: varchar("icon", { length: 16 }),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerName: uniqueIndex("categories_user_name_parent_idx").on(t.userId, t.name, sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`) }));

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 12 }).notNull().default("expense"),
  description: varchar("description", { length: 160 }).notNull(),
  merchant: varchar("merchant", { length: 120 }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  category: varchar("category", { length: 60 }).notNull().default("Other"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  transactionDate: date("transaction_date").notNull(),
  notes: text("notes"),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "set null" }),
  recurringId: uuid("recurring_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerDate: index("transactions_user_date_idx").on(t.userId, t.transactionDate), ownerTypeDate: index("transactions_user_type_date_idx").on(t.userId, t.type, t.transactionDate) }));

export const transactionSplits = pgTable("transaction_splits", {
  id: uuid("id").defaultRandom().primaryKey(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 100 }).notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  isMine: boolean("is_mine").notNull().default(false),
});

export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 40 }).notNull(),
}, (t) => ({ ownerName: uniqueIndex("tags_user_name_idx").on(t.userId, t.name) }));

export const transactionTags = pgTable("transaction_tags", {
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (t) => ({ pk: uniqueIndex("transaction_tags_pk").on(t.transactionId, t.tagId) }));

export const receipts = pgTable("receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  contentType: varchar("content_type", { length: 100 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const budgets = pgTable("budgets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  period: varchar("period", { length: 12 }).notNull().default("monthly"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  rollover: boolean("rollover").notNull().default(false),
  alertAt: integer("alert_at").notNull().default(80),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recurring = pgTable("recurring", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 12 }).notNull(),
  description: varchar("description", { length: 160 }).notNull(),
  category: varchar("category", { length: 60 }).notNull().default("Other"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  cadence: varchar("cadence", { length: 12 }).notNull(),
  nextDate: date("next_date").notNull(),
  // Day of month that monthly/yearly schedules return to after short months clamp it.
  anchorDay: smallint("anchor_day"),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recurringOccurrences = pgTable("recurring_occurrences", {
  id: uuid("id").defaultRandom().primaryKey(),
  recurringId: uuid("recurring_id").notNull().references(() => recurring.id, { onDelete: "cascade" }),
  dueDate: date("due_date").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("pending"),
  transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ scheduleDue: uniqueIndex("recurring_occurrences_schedule_due_idx").on(t.recurringId, t.dueDate) }));

export const alerts = pgTable("alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 180 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull(),
  message: text("message").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerKey: uniqueIndex("alerts_user_key_idx").on(t.userId, t.key), ownerDate: index("alerts_user_date_idx").on(t.userId, t.createdAt) }));

export const expenses = pgTable("expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 160 }).notNull(),
  category: varchar("category", { length: 40 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  spentOn: date("spent_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ userSpentOn: index("expenses_user_spent_on_idx").on(t.userId, t.spentOn) }));

export const refreshSessions = pgTable("refresh_sessions", {
  id: uuid("id").primaryKey(),
  familyId: uuid("family_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ userIdIdx: index("refresh_sessions_user_id_idx").on(t.userId), familyIdIdx: index("refresh_sessions_family_id_idx").on(t.familyId) }));
