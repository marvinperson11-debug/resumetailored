import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

// A single career highlight, revealed exactly while it is spoken. The numbered
// badge shows position (1 / 3) so the sequence still reads as a list.
export const HighlightOne: React.FC<{
  text: string;
  index: number;
  total: number;
  accent: string;
}> = ({ text, index, total, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const badge = spring({ frame, fps, config: { damping: 200 } });
  const inP = spring({ frame: frame - 5, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: 110,
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          color: theme.subtext,
          letterSpacing: 6,
          textTransform: 'uppercase',
          marginBottom: 40,
          opacity: inP,
        }}
      >
        Career Highlights
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 34, maxWidth: 980 }}>
        <div
          style={{
            minWidth: 96,
            height: 96,
            borderRadius: 28,
            background: accent,
            color: '#0B1220',
            fontSize: 46,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${badge})`,
          }}
        >
          {index + 1}
        </div>
        <div
          style={{
            fontSize: 54,
            color: theme.text,
            lineHeight: 1.3,
            fontWeight: 600,
            opacity: inP,
            transform: `translateX(${(1 - inP) * 40}px)`,
          }}
        >
          {text}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 56 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              width: i === index ? 46 : 14,
              height: 10,
              borderRadius: 6,
              background: i === index ? accent : `${accent}40`,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
