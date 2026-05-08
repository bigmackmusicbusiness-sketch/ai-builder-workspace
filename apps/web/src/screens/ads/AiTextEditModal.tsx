// apps/web/src/screens/ads/AiTextEditModal.tsx — AI-powered text replacement on
// an existing image. Used by the Ads Studio image editor's "AI edit text"
// button when the aiEditEnabled toggle is on.
//
// UX:
//   1. Modal opens with the source image rendered to a canvas.
//   2. User clicks-and-drags a rectangle over the region containing the
//      text they want to replace.
//   3. User types the replacement text.
//   4. On Submit:
//        a. We build a binary mask (white inside the rectangle, black
//           everywhere else) at the same dimensions as the source image.
//        b. POST /api/ai-edit/text multipart with image + mask + text.
//        c. Server runs Replicate Ideogram v2 inpainting + uploads the
//           result to Storage. Returns the new asset.
//   5. On success, the parent's onComplete callback receives the new asset
//      URL — typically the parent swaps the canvas background to the
//      edited image.
//
// Design choice: we use an interactive rectangle selector instead of
// Tesseract OCR (which the original plan called for) because adding
// tesseract.js to the SPA pulls in ~15 MB of WASM that we don't need
// for an internal-live release. The rectangle-draw flow is also
// arguably better UX — direct manipulation rather than OCR-then-pick.
import { useEffect, useRef, useState } from 'react';
import { apiFetchForm, ApiError } from '../../lib/api';

interface Props {
  /** URL of the image to edit (PNG/JPEG). */
  imageUrl: string;
  /** Project to attach the new asset to. NULL = tenant library. */
  projectId: string | null;
  /** Called when the inpaint succeeds with the URL of the edited image. */
  onComplete: (newUrl: string) => void;
  /** Called when the user dismisses the modal without completing. */
  onCancel: () => void;
}

interface Rect { x: number; y: number; w: number; h: number; }

export function AiTextEditModal({ imageUrl, projectId, onComplete, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [imgDims, setImgDims]       = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [drawing, setDrawing]       = useState(false);
  const [rect, setRect]             = useState<Rect | null>(null);
  const [replacement, setReplace]   = useState('');
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  // Load + draw the source image into the canvas. We render at the image's
  // natural dimensions so the mask we build matches pixel-for-pixel.
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      overlay.width = img.naturalWidth;
      overlay.height = img.naturalHeight;
      setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);
    };
    img.onerror = () => setErr('Failed to load image. CORS or expired URL?');
    img.src = imageUrl;
  }, [imageUrl]);

  // Re-paint the rectangle overlay whenever rect changes
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!rect) return;
    ctx.strokeStyle = '#1B8E8C';
    ctx.lineWidth = Math.max(2, Math.round(imgDims.w * 0.004));
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = 'rgba(27, 142, 140, 0.18)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }, [rect, imgDims.w]);

  // Map a mouse event to canvas coordinates. The canvas is rendered at
  // its natural resolution but displayed scaled — we need to invert that
  // scaling.
  function eventToCanvas(e: React.MouseEvent<HTMLCanvasElement>) {
    const overlay = overlayRef.current;
    if (!overlay) return { x: 0, y: 0 };
    const r = overlay.getBoundingClientRect();
    const sx = overlay.width  / r.width;
    const sy = overlay.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (busy) return;
    const p = eventToCanvas(e);
    setDrawing(true);
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing || !rect) return;
    const p = eventToCanvas(e);
    setRect({
      x: Math.min(rect.x, p.x),
      y: Math.min(rect.y, p.y),
      w: Math.abs(p.x - rect.x),
      h: Math.abs(p.y - rect.y),
    });
  }
  function handleMouseUp() {
    setDrawing(false);
  }

  async function handleSubmit() {
    if (!rect || rect.w < 4 || rect.h < 4) {
      setErr('Drag a rectangle over the text you want to replace.');
      return;
    }
    if (!replacement.trim()) {
      setErr('Type the replacement text.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      // Build the binary mask: white inside rect, black elsewhere
      const mask = document.createElement('canvas');
      mask.width = imgDims.w;
      mask.height = imgDims.h;
      const mctx = mask.getContext('2d');
      if (!mctx) throw new Error('Cannot create mask context');
      mctx.fillStyle = '#000';
      mctx.fillRect(0, 0, mask.width, mask.height);
      mctx.fillStyle = '#fff';
      mctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      const maskBlob = await new Promise<Blob>((resolve, reject) => {
        mask.toBlob((b) => b ? resolve(b) : reject(new Error('Mask toBlob failed')), 'image/png');
      });

      // Pull the source image bytes directly from the canvas we already
      // loaded — re-fetching imageUrl would CORS-fail for any host that
      // serves images with no Access-Control-Allow-Origin (Replicate
      // outputs occasionally fall in this bucket). The canvas was loaded
      // with crossOrigin='anonymous' so toBlob() succeeds.
      const sourceCanvas = canvasRef.current;
      if (!sourceCanvas) throw new Error('Canvas not ready');
      const imgBlob = await new Promise<Blob>((resolve, reject) => {
        sourceCanvas.toBlob((b) => b ? resolve(b) : reject(new Error('Canvas toBlob failed (tainted by CORS?)')), 'image/png');
      });

      // POST multipart
      const form = new FormData();
      form.append('image', imgBlob, 'src.png');
      form.append('mask',  maskBlob, 'mask.png');
      form.append('replacementText', replacement.trim());
      if (projectId) form.append('projectId', projectId);

      const res = await apiFetchForm<{ asset: { url: string } }>('/api/ai-edit/text', form);
      onComplete(res.asset.url);
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        setErr('Add REPLICATE_API_TOKEN in Settings → Secrets to enable AI text edit.');
      } else {
        setErr(e instanceof ApiError ? e.message : 'AI text edit failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label="AI text edit" style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0, 0, 0, 0.6)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--surface-base)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-overlay)',
        padding: 'var(--space-3)',
        maxWidth: 'min(900px, 95vw)',
        maxHeight: '95vh',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        overflow: 'hidden',
      }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>AI text edit</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Drag a rectangle over the text. Type the replacement. Submit. ~$0.08 per call.
            </p>
          </div>
          <button onClick={onCancel} aria-label="Close" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', fontSize: '1.25rem',
          }}>✕</button>
        </header>

        {/* Canvas + overlay (stacked) */}
        <div style={{
          position: 'relative', flex: 1,
          maxHeight: '60vh', overflow: 'auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0a0a0a', borderRadius: 'var(--radius-card)',
        }}>
          <canvas
            ref={canvasRef}
            style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block' }}
          />
          <canvas
            ref={overlayRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              position: 'absolute',
              maxWidth: '100%', maxHeight: '60vh', display: 'block',
              cursor: busy ? 'wait' : 'crosshair',
            }}
          />
        </div>

        <input
          value={replacement}
          onChange={(e) => setReplace(e.target.value)}
          placeholder="Replacement text…"
          maxLength={100}
          style={{
            padding: 'var(--space-2)',
            border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)',
            background: 'var(--surface-base)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
            fontFamily: 'inherit',
          }}
        />

        {err && (
          <div role="alert" style={{
            padding: 'var(--space-2)',
            background: 'var(--color-error-bg)',
            color: 'var(--color-error)',
            borderRadius: 'var(--radius-card)',
            fontSize: '0.8125rem',
          }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => void handleSubmit()} disabled={busy} style={{
            flex: 1, padding: 'var(--space-2)',
            background: 'var(--accent-500)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-button)',
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
            fontWeight: 600, fontSize: '0.875rem',
          }}>
            {busy ? 'Inpainting (5-15s)…' : 'Replace text'}
          </button>
          <button onClick={onCancel} style={{
            padding: 'var(--space-2) var(--space-3)',
            border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)',
            background: 'var(--bg-subtle)',
            cursor: 'pointer', fontSize: '0.75rem',
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
