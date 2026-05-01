// apps/api/src/lib/assetUpload.ts — server-side helper for programmatic uploads.
// Used by ebooks/documents/music routes (no multipart involvement — pure Buffer).
import { createClient } from '@supabase/supabase-js';
import { getDb } from '../db/client';
import { assets } from '@abw/db';
import { env } from '../config/env';

const BUCKET = 'project-assets';

export interface UploadOpts {
  tenantId:  string;
  projectId: string | null;
  folder:    string;          // logical folder under tenantId, e.g. "ebooks/{id}"
  filename:  string;          // display name + file extension
  mimeType:  string;
  buffer:    Buffer;
}

export interface UploadResult {
  assetId: string;
  url:     string;
}

/** Upload a server-generated file to Supabase Storage and insert an `assets` row. */
export async function uploadBufferAsAsset(opts: UploadOpts): Promise<UploadResult> {
  const storage = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY).storage;
  const safeName   = opts.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${opts.tenantId}/${opts.folder}/${Date.now()}-${safeName}`;

  const { error } = await storage.from(BUCKET).upload(storagePath, opts.buffer, {
    contentType: opts.mimeType,
    upsert:      false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  const db = getDb();
  // projectId is now nullable on assets — tenant-scoped assets can have
  // project_id = NULL (migration 0006).
  const [row] = await db.insert(assets).values({
    projectId:   opts.projectId,
    tenantId:    opts.tenantId,
    name:        opts.filename,
    storagePath,
    mimeType:    opts.mimeType,
    size:        opts.buffer.length,
    publicUrl,
  }).returning();

  if (!row) throw new Error('Failed to insert asset row');
  return { assetId: row.id, url: publicUrl };
}
