import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

// Small headshot. Legacy behaviour (no `position`): top-left corner, persistent across the whole video.
// With `position` (the Next.js app's draggable headshot): the badge's CENTRE sits at x/y (0–1 fractions of
// the frame), kept fully inside the frame. The caller decides WHEN it is mounted (title slide only, or every
// slide), so this component only fades in on mount.
export const PhotoBadge: React.FC<{
  photoUrl?: string;
  accent: string;
  position?: { x: number; y: number };
}> = ({ photoUrl, accent, position }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (!photoUrl) return null;
  const opacity = interpolate(frame, [4, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const size = position ? 168 : 132;
  const left = position
    ? Math.min(width - size - 24, Math.max(24, position.x * width - size / 2))
    : 56;
  const top = position
    ? Math.min(height - size - 24, Math.max(24, position.y * height - size / 2))
    : 56;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <Img
        src={photoUrl}
        style={{
          position: 'absolute',
          left,
          top,
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          border: `5px solid ${accent}`,
          boxShadow: `0 10px 30px ${accent}55`,
          opacity,
        }}
      />
    </AbsoluteFill>
  );
};
