import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { hexToRgb, luminance } from '../theme';

// Matches the website: a very dark base (#030712) with soft indigo/violet glow
// orbs — the same look as the landing-page hero (.hero-orb) — that slowly drift
// so the backdrop feels alive without competing with the content.
const INDIGO = 'rgba(99,102,241,'; // #6366F1
const VIOLET = 'rgba(139,92,246,'; // #8B5CF6

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * `base` (optional): a user-chosen background colour. Without it the original website look above is used,
 * unchanged. With it, the colour fills the frame and a slow, low-contrast gradient drift (two soft blobs of a
 * lighter/darker shade of the same colour plus a faint accent tint, and a gently rotating wash) moves behind
 * the slides — restrained on purpose: the motion is a few percent of brightness over a ~20s cycle.
 */
export const Background: React.FC<{ accent?: string; base?: string }> = ({ accent, base }) => {
  const frame = useCurrentFrame();

  if (base) {
    const b = hexToRgb(base);
    const light = luminance(base) > 0.4;
    const shade = light ? mix(b, [0, 0, 0], 0.1) : mix(b, [255, 255, 255], 0.1);
    const tint = hexToRgb(accent || '#6366F1');
    const blob = (x: number, y: number, size: number, color: string, speed: number, phase: number): React.CSSProperties => ({
      position: 'absolute',
      left: `${x}%`,
      top: `${y}%`,
      width: size,
      height: size,
      marginLeft: -size / 2,
      marginTop: -size / 2,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      transform: `translate(${Math.sin(frame / speed + phase) * 70}px, ${Math.cos(frame / (speed * 1.3) + phase) * 56}px)`,
    });
    const angle = 160 + Math.sin(frame / 160) * 28; // slow rotation of the wash, ±28°
    return (
      <AbsoluteFill style={{ backgroundColor: base, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(${angle}deg, ${rgba(shade, 0.55)} 0%, ${rgba(shade, 0)} 55%, ${rgba(tint, 0.1)} 100%)`,
          }}
        />
        <div style={blob(28, 24, 1250, rgba(shade, 0.7), 140, 0)} />
        <div style={blob(76, 78, 1300, rgba(tint, light ? 0.1 : 0.14), 110, 2.1)} />
      </AbsoluteFill>
    );
  }

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
