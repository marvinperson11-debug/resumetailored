import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { theme } from '../theme';

// Living backdrop: a few large, soft colour blobs that slowly drift and breathe
// behind every scene, so the video never feels like a static slideshow.
export const Background: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();

  const blob = (
    x: number,
    y: number,
    size: number,
    color: string,
    speed: number,
    phase: number,
  ): React.CSSProperties => ({
    position: 'absolute',
    left: `${x}%`,
    top: `${y}%`,
    width: size,
    height: size,
    borderRadius: '50%',
    background: color,
    filter: 'blur(60px)',
    opacity: 0.5,
    transform: `translate(${Math.sin(frame / speed + phase) * 50}px, ${Math.cos(frame / (speed * 1.25) + phase) * 36}px)`,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, overflow: 'hidden' }}>
      <div style={blob(16, 14, 480, `${accent}55`, 95, 0)} />
      <div style={blob(74, 72, 540, `${theme.accent}44`, 72, 2.1)} />
      <div style={blob(58, 28, 380, `${accent}33`, 120, 4.2)} />
      <div style={blob(24, 82, 360, `${theme.accent}33`, 84, 1.1)} />
    </AbsoluteFill>
  );
};
