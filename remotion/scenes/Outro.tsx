import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

// Closing card. The brand itself now lives in the small corner watermark, so
// the end no longer flashes a giant logo — just a clean, modest call to action.
export const Outro: React.FC<{ brand: string; accent: string }> = ({
  brand,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', padding: 100 }}
    >
      <div style={{ fontSize: 36, color: theme.subtext, opacity: p }}>
        Tailored with {brand}
      </div>
      <div
        style={{
          fontSize: 60,
          fontWeight: 800,
          color: accent,
          marginTop: 18,
          opacity: p,
          transform: `translateY(${(1 - p) * 22}px)`,
        }}
      >
        resumetailored.com
      </div>
    </AbsoluteFill>
  );
};
