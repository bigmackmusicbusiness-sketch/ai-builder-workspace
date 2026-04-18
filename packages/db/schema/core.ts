// packages/db/schema/core.ts — shared column helpers + tenants + users + memberships.
import { pgTable, text, timestamp, boolean, uuid, pgEnum } from 'drizzle-orm/pg-core';

// ── Shared helpers ─────────────────────────────────────────────────
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),  // soft-delete
};

// ── Tenants ────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  slug:      text('slug').notNull().unique(),
  plan:      text('plan').notNull().default('free'),
  active:    boolean('active').notNull().default(true),
  ...timestamps,
});

// ── Users ──────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  supabaseUid:  text('supabase_uid').notNull().unique(),  // auth.users.id
  email:        text('email').notNull(),
  name:         text('name'),
  avatarUrl:    text('avatar_url'),
  ...timestamps,
});

// ── Role enum ─────────────────────────────────────────────────────
export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'admin', 'member', 'viewer']);

// ── Memberships ────────────────────────────────────────────────────
export const memberships = pgTable('memberships', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId:   uuid('user_id').notNull().references(() => users.id),
  role:     membershipRoleEnum('role').notNull().default('member'),
  ...timestamps,
});
