// apps/web/src/components/SafeZoneOverlay.tsx — Meta safe-zone overlay for ad canvases.
//
// 9:16 placements (Stories, Reels) reserve the top 250px and the bottom
// 250px for system UI (profile pic, share/like row). Anything important
// drawn there gets covered. Render this overlay as a translucent dim
// over those bands so the user can see exactly where to keep copy.
//
// 1:1 + 4:5 placements have no system-overlay zone — the component is a
// no-op for those.
import type { AdPlacement, AdAspect } from '../screens/AdsStudioScreen';

interface Props {
  placement:   AdPlacement;
  aspectRatio: AdAspect;
  /** Canvas height in CSS px (the overlay scales the safe-zone bands to this). */
  canvasHeight: number;
}

export function SafeZoneOverlay({ placement, aspectRatio, canvasHeight }: Props) {
  // Only 9:16 has the system-UI bands — use them for Stories/Reels regardless
  // of the technical "marketplace" placement choice.
  const showBands = aspectRatio === '9:16' && (placement === 'stories' || placement === 'reels');
  if (!showBands) return null;

  // 1080×1920 reference; 250px / 1920 ≈ 13% of the canvas height
  const bandPct = 13;
  const bandPx  = (bandPct / 100) * canvasHeight;

  return (
    <div aria-hidden style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: bandPx,
        background: 'rgba(0, 0, 0, 0.35)',
        borderBottom: '1px dashed rgba(255, 255, 255, 0.6)',
      }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: bandPx,
        background: 'rgba(0, 0, 0, 0.35)',
        borderTop: '1px dashed rgba(255, 255, 255, 0.6)',
      }} />
      <span style={{
        position: 'absolute', top: 4, left: 8,
        fontSize: '0.625rem', color: 'rgba(255,255,255,0.85)',
        fontWeight: 600, textShadow: '0 0 4px rgba(0,0,0,0.6)',
      }}>
        Safe-zone (system UI)
      </span>
    </div>
  );
}
