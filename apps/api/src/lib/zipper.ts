// apps/api/src/lib/zipper.ts — streaming ZIP creation via archiver.
// Used by Music Studio (stems + final + metadata) and eBook KDP bundle.

export interface ZipEntry {
  path:    string;           // path inside the archive
  content: Buffer | string;  // file contents
}

/** Build a ZIP Buffer from an in-memory list of entries. */
export async function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const archiverMod: any = await import('archiver');
  const archiver = archiverMod.default ?? archiverMod;
  const zip = archiver('zip', { zlib: { level: 6 } });

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.on('data', (c: Buffer) => chunks.push(c));
    zip.on('error', (err: Error) => reject(err));
    zip.on('end', () => resolve(Buffer.concat(chunks)));

    for (const e of entries) {
      const data = typeof e.content === 'string' ? Buffer.from(e.content, 'utf8') : e.content;
      zip.append(data, { name: e.path });
    }
    void zip.finalize();
  });
}
