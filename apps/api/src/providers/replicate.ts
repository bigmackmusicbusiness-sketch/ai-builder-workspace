// apps/api/src/providers/replicate.ts — Replicate client for Demucs stem separation.

const REPLICATE_BASE = 'https://api.replicate.com/v1';
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 5 * 60 * 1_000; // 5 minutes

export interface StemBuffers {
  drums:  Buffer;
  bass:   Buffer;
  other:  Buffer;
  vocals: Buffer;
}

/** Upload a WAV buffer to Replicate's Demucs model and return the 4 stem buffers. */
export async function separateStems(opts: {
  wavBuffer:      Buffer;
  replicateToken: string;
}): Promise<StemBuffers> {
  const { wavBuffer, replicateToken } = opts;
  const authHeader = `Token ${replicateToken}`;

  // Encode WAV as data URI so we don't need a separate upload step
  const b64 = wavBuffer.toString('base64');
  const audioDataUri = `data:audio/wav;base64,${b64}`;

  // Create prediction
  const createRes = await fetch(
    `${REPLICATE_BASE}/models/ryan5453/demucs/predictions`,
    {
      method: 'POST',
      headers: {
        Authorization:  authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: { audio: audioDataUri } }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '');
    throw new Error(`Replicate create prediction failed (HTTP ${createRes.status}): ${detail}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prediction = await createRes.json() as any;
  const predictionId: string = prediction['id'];
  if (!predictionId) throw new Error('Replicate: no prediction id in response');

  // Poll until succeeded or timed out
  const deadline = Date.now() + MAX_POLL_MS;
  let output: { drums: string; bass: string; other: string; vocals: string } | undefined;

  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(
      `${REPLICATE_BASE}/predictions/${predictionId}`,
      {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!pollRes.ok) {
      const detail = await pollRes.text().catch(() => '');
      throw new Error(`Replicate poll failed (HTTP ${pollRes.status}): ${detail}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poll = await pollRes.json() as any;
    const status: string = poll['status'];

    if (status === 'failed' || status === 'canceled') {
      const err: string = poll['error'] ?? status;
      throw new Error(`Replicate prediction ${status}: ${err}`);
    }

    if (status === 'succeeded') {
      output = poll['output'] as typeof output;
      break;
    }
    // status === 'starting' | 'processing' — keep polling
  }

  if (!output) {
    throw new Error('Replicate stem separation timed out after 5 minutes');
  }

  // Fetch each stem URL → Buffer
  const [drums, bass, other, vocals] = await Promise.all([
    fetchStem(output.drums,  authHeader),
    fetchStem(output.bass,   authHeader),
    fetchStem(output.other,  authHeader),
    fetchStem(output.vocals, authHeader),
  ]);

  return { drums, bass, other, vocals };
}

async function fetchStem(url: string, _authHeader: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to fetch stem from ${url}: HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
