import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

// Closing scene. Shows the candidate's spoken sign-off line (chosen from the
// outro picker or custom). No website splash — the brand lives quietly in the
// corner watermark, so the end is about the candidate's closing words.
export const Outro: React.FC<{ text: string; name?: string; accent: string }> = ({
  text,
  name,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rule = spring({ frame, fps, config: { damping: 200 } });
  const inP = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const signoff = spring({ frame: frame - 14, fps, config: { damping: 200 } });
  const float = Math.sin(frame / 16) * 6;
  // Longer messages get a slightly smaller font so they always fit the frame.
  const fontSize = (text || '').length > 130 ? 46 : 54;

  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', padding: 110, transform: `translateY(${float}px)` }}
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
          fontSize,
          fontWeight: 600,
          color: theme.text,
          textAlign: 'center',
          maxWidth: 940,
          lineHeight: 1.4,
          opacity: inP,
          transform: `translateY(${(1 - inP) * 24}px)`,
        }}
      >
        {text}
      </div>
      {name ? (
        <div
          style={{
            fontSize: 40,
            fontWeight: 800,
            color: accent,
            marginTop: 44,
            opacity: signoff,
            transform: `translateY(${(1 - signoff) * 18}px)`,
          }}
        >
          — {name}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
