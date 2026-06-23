import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

export const Outro: React.FC<{ brand: string; accent: string }> = ({
  brand,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', padding: 90 }}
    >
      <div style={{ fontSize: 44, color: theme.subtext, opacity: p }}>
        Tailored with
      </div>
      <div
        style={{
          fontSize: 86,
          fontWeight: 800,
          color: accent,
          marginTop: 18,
          transform: `scale(${p})`,
        }}
      >
        {brand}
      </div>
      <div style={{ marginTop: 44, fontSize: 32, color: theme.subtext, opacity: p }}>
        resumetailored.com
      </div>
    </AbsoluteFill>
  );
};
