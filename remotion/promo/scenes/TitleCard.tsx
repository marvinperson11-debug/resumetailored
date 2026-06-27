import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../../theme';

// Opening scene: brand name + tagline. No bleed-through from other layers —
// this scene owns a fully opaque background of its own.
export const TitleCard: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const mark = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  const nameIn = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  const tagIn = spring({ frame: frame - 14, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          background: `linear-gradient(135deg, ${theme.primary}, ${theme.accent})`,
          marginBottom: 36,
          transform: `scale(${mark})`,
        }}
      />
      <div
        style={{
          fontSize: 72,
          fontWeight: 800,
          color: theme.text,
          opacity: nameIn,
          transform: `translateY(${(1 - nameIn) * 24}px)`,
        }}
      >
        ResumeTailored <span style={{ color: theme.primary }}>AI</span>
      </div>
      <div
        style={{
          fontSize: 32,
          color: theme.subtext,
          marginTop: 18,
          opacity: tagIn,
          transform: `translateY(${(1 - tagIn) * 18}px)`,
        }}
      >
        Your resume, perfectly tailored to every job.
      </div>
    </AbsoluteFill>
  );
};
