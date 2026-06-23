import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { theme } from '../theme';

// Slow-drifting radial gradients so the static text always sits on a subtly
// moving backdrop. Rendered once behind every scene.
export const Background: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 600], [0, 60], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        backgroundImage: `radial-gradient(circle at 28% ${18 + drift / 3}%, ${accent}33, transparent 42%), radial-gradient(circle at 78% ${82 - drift / 4}%, ${theme.accent}22, transparent 48%)`,
      }}
    />
  );
};
