// packages/site-data/types.ts — Phase 3 cross-platform data types.
//
// Shapes the SPS-consumed `signalpoint-config.json` contract (per
// HANDOFF_NOTES.md OUTBOUND TO SPS round 2) plus the runtime binding
// surface generated sites use to read live workspace data.
//
// Used by:
//   - apps/api code-gen path (when injecting the shim into a generated site)
//   - packages/site-data runtime (the actual fetch path on the customer site)
//   - apps/api publish flow (when emitting signalpoint-config.json)

import { z } from 'zod';

// ── signalpoint-config.json contract (matches OUTBOUND TO SPS round 2 §7) ──

/** The runtime config the publish step writes to the project bundle when a
 *  workspace has an SPS link. ABW's site-data shim reads this on first
 *  request and caches the resolved supabase URL + anon key for the
 *  remainder of the page lifecycle. */
export const SignalPointConfigSchema = z.object({
  /** UUID of the SPS workspace that owns this customer's data. Becomes the
   *  `x-workspace-id` header on every read so RLS scopes correctly. */
  workspace_id: z.string().uuid(),
  /** Customer-facing Supabase project URL. Public information — RLS is what
   *  scopes the data, not URL secrecy. */
  supabase_url: z.string().url(),
  /** Workspace-scoped anon JWT. Safe to bake into a static bundle because
   *  the public-read RLS policies enforce per-workspace boundaries even on
   *  the open internet. */
  anon_key: z.string().min(1),
  /** HS256 token for embed-edge requests (form submissions, mutations).
   *  Reads don't need this — they go directly to Supabase. */
  edge_token: z.string().min(1),
  /** ISO 8601 timestamp when ABW should re-fetch site-config from the SPS
   *  issuer endpoint. The shim refetches when within 24h of expiry. */
  expires_at: z.string().datetime(),
});

export type SignalPointConfig = z.infer<typeof SignalPointConfigSchema>;

// ── Vertical kinds (mirrors NicheManifest.vertical_kind) ──

export type VerticalKind = 'restaurant' | 'auto-dealer' | 'gym' | 'retail' | 'services';

// ── Source table → template binding map ──

/** Names of the SPS source tables ABW's shim reads from. Mirrors the
 *  dedicated tables SPS migrates to per the OUTBOUND TO SPS round 2
 *  decision (Option B: dedicated tables, not view-aliases). */
export type SourceTable =
  | 'menu_sections'
  | 'menu_items'
  | 'vehicles'
  | 'class_schedule';

/** A binding declared in a niche manifest. The shim reads `source` and
 *  exposes the rows under `target` to the generated site's templates. */
export interface SiteDataBinding {
  source: SourceTable;
  /** Template binding name (e.g. 'menu', 'inventory', 'schedule'). The
   *  generated HTML refers to rows by this name. */
  target: string;
}

// ── Runtime row shapes (per OUTBOUND TO SPS round 2 §"ABW shim's read contract") ──

/** A row from the menu_sections table. */
export interface MenuSection {
  id:           string;
  workspace_id: string;
  name:         string;
  position:     number;
  description?: string | null;
}

/** A row from the menu_items table. Renders sorted by section, then
 *  position. Hides rows where `available = false`. */
export interface MenuItem {
  id:           string;
  workspace_id: string;
  section_id?:  string | null;
  name:         string;
  description?: string | null;
  price_cents:  number;
  currency:     string;
  available:    boolean;
  position:     number;
  allergens:    string[];
  photos:       Array<{ url: string; alt?: string }>;
}

/** A row from the vehicles table. Renders WHERE status='available' on the
 *  public listings page. */
export interface Vehicle {
  id:              string;
  workspace_id:    string;
  category:        string;        // 'sedan' | 'suv' | 'motorcycle' | 'boat' | etc.
  year:            number;
  make:            string;
  model:           string;
  trim?:           string | null;
  vin?:            string | null;
  mileage?:        number | null;
  price_cents:     number;
  currency:        string;
  status:          'available' | 'pending' | 'sold';
  exterior_color?: string | null;
  interior_color?: string | null;
  photos:          Array<{ url: string; alt?: string; position?: number }>;
  features:        string[];
  description?:    string | null;
}

/** A row from the class_schedule table. NO PII (those live in a separate
 *  bookings table SPS owns; ABW doesn't read it). */
export interface ClassScheduleEntry {
  id:               string;
  workspace_id:     string;
  program_name:     string;
  instructor_name?: string | null;
  start_at:         string;       // ISO 8601
  end_at:           string;       // ISO 8601
  capacity?:        number | null;
  spots_remaining?: number | null;
  location_name?:   string | null;
  status:           'scheduled' | 'cancelled' | 'full';
  notes?:           string | null;
}

// ── Lookup-by-target helper type ──

/** Maps a binding target name to the row type the shim returns. Generated
 *  sites get autocomplete on `data.menu` etc. when they import this type. */
export interface BindingResultMap {
  sections:  MenuSection[];
  menu:      MenuItem[];
  inventory: Vehicle[];
  schedule:  ClassScheduleEntry[];
}
