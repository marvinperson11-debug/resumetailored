import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion';

// Small, persistent headshot in the TOP-LEFT corner — small but noticeable, with
// a subtle accent ring. Shown across the whole video (like the bottom-right
// Watermark) whenever the user uploaded a photo. Fades in once and stays put.
export const PhotoBadge: React.FC<{ photoUrl?: string; accent: string }> = ({
  photoUrl,
  accent,
}) => {
  const frame = useCurrentFrame();
  if (!photoUrl) return null;
  const opacity = interpolate(frame, [4, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <Img
        src={photoUrl}
        style={{
          position: 'absolute',
          left: 56,
          top: 56,
          width: 132,
          height: 132,
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
