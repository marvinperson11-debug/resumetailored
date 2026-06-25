import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

// Matches the website: a very dark base (#030712) with soft indigo/violet glow
// orbs — the same look as the landing-page hero (.hero-orb) — that slowly drift
// so the backdrop feels alive without competing with the content.
const INDIGO = 'rgba(99,102,241,'; // #6366F1
const VIOLET = 'rgba(139,92,246,'; // #8B5CF6

export const Background: React.FC<{ accent?: string }> = () => {
  const frame = useCurrentFrame();

  const orb = (
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
    marginLeft: -size / 2,
    marginTop: -size / 2,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
    transform: `translate(${Math.sin(frame / speed + phase) * 60}px, ${Math.cos(frame / (speed * 1.25) + phase) * 44}px)`,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#030712', overflow: 'hidden' }}>
      <div style={orb(26, 22, 1200, `${INDIGO}0.34)`, 105, 0)} />
      <div style={orb(78, 76, 1300, `${VIOLET}0.26)`, 80, 2.1)} />
      <div style={orb(64, 44, 900, `${INDIGO}0.18)`, 130, 4.2)} />
      <div style={orb(16, 84, 820, `${VIOLET}0.16)`, 95, 1.2)} />
    </AbsoluteFill>
  );
};
