import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../../theme';

// Closing CTA. Owns a fully opaque background so nothing from the previous
// scene can show through during the transition (the original promo video had
// a stale dashboard screenshot bleeding through behind this title card).
export const ClosingCard: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const urlIn = spring({ frame, fps, config: { damping: 200 } });
  const ctaIn = spring({ frame: frame - 12, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeIn,
      }}
    >
      <div
        style={{
          fontSize: 64,
          fontWeight: 800,
          color: theme.text,
          opacity: urlIn,
          transform: `translateY(${(1 - urlIn) * 20}px)`,
        }}
      >
        resumetailored<span style={{ color: accent }}>.com</span>
      </div>
      <div
        style={{
          marginTop: 30,
          fontSize: 28,
          fontWeight: 700,
          color: theme.bg,
          background: `linear-gradient(135deg, ${theme.primary}, ${theme.accent})`,
          borderRadius: 12,
          padding: '16px 38px',
          opacity: ctaIn,
          transform: `translateY(${(1 - ctaIn) * 16}px)`,
        }}
      >
        Tailor My Resume Free →
      </div>
      <div style={{ marginTop: 22, fontSize: 22, color: theme.subtext, opacity: ctaIn }}>
        1 free tailoring · No payment required
      </div>
    </AbsoluteFill>
  );
};
