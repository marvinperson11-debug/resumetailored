import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

// Numbered achievement cards that slide in one after another.
export const Highlights: React.FC<{ highlights: string[]; accent: string }> = ({
  highlights,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 90 }}>
      <div
        style={{
          fontSize: 38,
          fontWeight: 700,
          color: theme.subtext,
          letterSpacing: 6,
          marginBottom: 50,
          textTransform: 'uppercase',
        }}
      >
        Career Highlights
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {highlights.map((h, i) => {
          const delay = i * Math.round(0.5 * fps);
          const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 26,
                background: theme.card,
                border: `1px solid ${accent}40`,
                borderRadius: 26,
                padding: '30px 34px',
                opacity: p,
                transform: `translateX(${(1 - p) * -70}px)`,
              }}
            >
              <div
                style={{
                  minWidth: 60,
                  height: 60,
                  borderRadius: 18,
                  background: accent,
                  color: '#0B1220',
                  fontSize: 32,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  fontSize: 37,
                  color: theme.text,
                  lineHeight: 1.34,
                  fontWeight: 500,
                }}
              >
                {h}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
