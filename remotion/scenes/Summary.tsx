import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

// Shown while the summary line is spoken. Just the summary, large and centered.
export const Summary: React.FC<{ summary: string; accent: string }> = ({
  summary,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rule = spring({ frame, fps, config: { damping: 200 } });
  const inP = spring({ frame: frame - 4, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', padding: 110 }}
    >
      <div
        style={{
          width: 110,
          height: 8,
          borderRadius: 4,
          backgroundColor: accent,
          marginBottom: 50,
          transform: `scaleX(${rule})`,
        }}
      />
      <div
        style={{
          fontSize: 58,
          fontWeight: 600,
          color: theme.text,
          textAlign: 'center',
          maxWidth: 900,
          lineHeight: 1.4,
          opacity: inP,
          transform: `translateY(${(1 - inP) * 26}px)`,
        }}
      >
        {summary}
      </div>
    </AbsoluteFill>
  );
};
