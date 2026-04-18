// apps/web/src/features/editor/languageFromPath.ts — map file extension to Monaco language ID.
const EXT_MAP: Record<string, string> = {
  ts:   'typescript',
  tsx:  'typescript',
  js:   'javascript',
  jsx:  'javascript',
  mjs:  'javascript',
  cjs:  'javascript',
  json: 'json',
  css:  'css',
  scss: 'scss',
  html: 'html',
  md:   'markdown',
  mdx:  'markdown',
  sql:  'sql',
  yaml: 'yaml',
  yml:  'yaml',
  toml: 'ini',
  sh:   'shell',
  bash: 'shell',
  env:  'plaintext',
  txt:  'plaintext',
  py:   'python',
  go:   'go',
  rs:   'rust',
};

export function languageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? 'plaintext';
}
