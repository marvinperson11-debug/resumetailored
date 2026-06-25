import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

// Closing celebration: two people at a desk (a job interview) reach across and
// shake hands — they got the job — with a confetti burst and a "Got the job!"
// caption. Pure vector art so it renders regardless of installed fonts.
export const Hired: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Reach + clasp, then a gentle handshake shake.
  const reach = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  const shakeStart = 34;
  const shake = frame > shakeStart ? Math.sin((frame - shakeStart) / 1.6) * 6 * reach : 0;
  const lerp = (a: number, b: number) => a + (b - a) * reach;
  const lhx = lerp(345, 442);
  const lhy = lerp(420, 402) + shake;
  const rhx = lerp(555, 458);
  const rhy = lerp(420, 402) - shake;
  const cx = (lhx + rhx) / 2;
  const cy = (lhy + rhy) / 2;

  const cap = spring({ frame: frame - 33, fps, config: { damping: 12, mass: 0.7 } });

  const colors = [accent, '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a855f7'];
  const confetti = Array.from({ length: 30 }).map((_, i) => {
    const seed = ((i * 9301 + 49297) % 233280) / 233280;
    const startX = 50 + seed * 800;
    const t = Math.max(0, frame - 33);
    const y = -50 + t * (4 + seed * 5);
    const x = startX + Math.sin(t / 8 + i) * 24;
    const rot = (t * (4 + seed * 6)) % 360;
    const op = interpolate(t, [0, 4, 80, 100], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return { x, y, rot, op, c: colors[i % colors.length], w: 10 + seed * 8, h: 16 + seed * 10 };
  });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
      <svg width="900" height="720" viewBox="0 0 900 720" style={{ overflow: 'visible' }}>
        {/* confetti */}
        {confetti.map((p, i) => (
          <rect
            key={i}
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.h}
            rx={2}
            fill={p.c}
            opacity={p.op}
            transform={`rotate(${p.rot} ${p.x + p.w / 2} ${p.y + p.h / 2})`}
          />
        ))}

        {/* left candidate */}
        <path d="M120,360 C120,250 310,250 310,360 L310,470 L120,470 Z" fill={accent} />
        <circle cx="215" cy="168" r="62" fill="#eab38c" />
        {/* tie hint */}
        <path d="M205,232 L225,232 L235,300 L195,300 Z" fill={`${accent}`} stroke="#0b1220" strokeWidth="3" />

        {/* right interviewer */}
        <path d="M590,360 C590,250 780,250 780,360 L780,470 L590,470 Z" fill="#64748b" />
        <circle cx="685" cy="168" r="62" fill="#c98c63" />

        {/* desk in front */}
        <rect x="55" y="455" width="790" height="150" rx="16" fill="#111827" />
        <rect x="55" y="455" width="790" height="12" rx="6" fill={accent} opacity="0.9" />

        {/* forearms reaching to the handshake */}
        <line x1="300" y1="360" x2={lhx} y2={lhy} stroke="#eab38c" strokeWidth="30" strokeLinecap="round" />
        <line x1="600" y1="360" x2={rhx} y2={rhy} stroke="#c98c63" strokeWidth="30" strokeLinecap="round" />
        {/* clasped hands */}
        <ellipse cx={cx} cy={cy} rx="36" ry="27" fill="#eab38c" opacity={reach} />
        <ellipse cx={cx + 6} cy={cy} rx="24" ry="25" fill="#c98c63" opacity={reach} />
      </svg>

      {/* caption */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          transform: `scale(${cap})`,
          opacity: Math.min(cap, 1),
        }}
      >
        <div
          style={{
            width: 74,
            height: 74,
            borderRadius: '50%',
            background: '#10b981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="42" height="42" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ fontSize: 78, fontWeight: 900, color: theme.text, letterSpacing: 1, whiteSpace: 'nowrap' }}>Got the job!</div>
      </div>
    </AbsoluteFill>
  );
};
