import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { theme } from '../theme';

// Small, persistent brand mark in the bottom-right corner — replaces the old
// full-screen logo splash. Fades in once and stays put.
export const Watermark: React.FC<{ brand: string; accent: string }> = ({
  brand,
  accent,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [6, 22], [0, 0.92], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          right: 56,
          bottom: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          opacity,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 6,
            background: accent,
          }}
        />
        <div style={{ fontSize: 30, fontWeight: 700, color: theme.subtext }}>
          {brand}
        </div>
      </div>
    </AbsoluteFill>
  );
};
