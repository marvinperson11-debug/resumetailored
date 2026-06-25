import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

// Skill pills that pop in with a staggered spring.
export const Skills: React.FC<{ skills: string[]; accent: string }> = ({
  skills,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const float = Math.sin(frame / 16) * 8;

  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', padding: 90, transform: `translateY(${float}px)` }}
    >
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
        Core Skills
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 22,
          justifyContent: 'center',
          maxWidth: 920,
        }}
      >
        {skills.map((s, i) => {
          const p = spring({
            frame: frame - i * 3,
            fps,
            config: { damping: 14, mass: 0.6 },
          });
          return (
            <div
              key={i}
              style={{
                fontSize: 35,
                fontWeight: 600,
                color: theme.text,
                background: `${accent}26`,
                border: `1px solid ${accent}66`,
                borderRadius: 999,
                padding: '16px 36px',
                transform: `scale(${p})`,
                opacity: Math.min(p, 1),
              }}
            >
              {s}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
