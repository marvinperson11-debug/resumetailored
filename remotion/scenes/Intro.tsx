import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

export const Intro: React.FC<{
  name: string;
  title: string;
  summary: string;
  accent: string;
  photoUrl?: string;
}> = ({ name, title, summary, accent, photoUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const popIn = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  const nameIn = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  const titleIn = spring({ frame: frame - 16, fps, config: { damping: 200 } });
  const sumIn = spring({ frame: frame - 26, fps, config: { damping: 200 } });
  // Friendly waving hand: rocks back and forth.
  const wave = interpolate(Math.sin(frame / 3.5), [-1, 1], [-22, 22]);
  // Gentle continuous float so the frame never feels static.
  const float = Math.sin(frame / 16) * 8;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: 90,
        flexDirection: 'column',
      }}
    >
      <div style={{ transform: `translateY(${float}px)`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {photoUrl ? (
          <div
            style={{
              position: 'relative',
              width: 320,
              height: 320,
              marginBottom: 36,
              transform: `scale(${popIn})`,
            }}
          >
            <Img
              src={photoUrl}
              style={{
                width: 320,
                height: 320,
                borderRadius: '50%',
                objectFit: 'cover',
                border: `8px solid ${accent}`,
                boxShadow: `0 24px 60px ${accent}55`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: -6,
                right: -6,
                fontSize: 64,
                transform: `rotate(${wave}deg)`,
                transformOrigin: '70% 70%',
              }}
            >
              👋
            </div>
          </div>
        ) : (
          <div
            style={{
              fontSize: 150,
              marginBottom: 18,
              transform: `scale(${popIn}) rotate(${wave}deg)`,
              transformOrigin: '70% 70%',
            }}
          >
            👋
          </div>
        )}

        <div style={{ fontSize: 40, color: theme.subtext, opacity: nameIn, letterSpacing: 1 }}>
          Hi, I&rsquo;m
        </div>
        <div
          style={{
            fontSize: 104,
            fontWeight: 800,
            color: theme.text,
            textAlign: 'center',
            lineHeight: 1.03,
            marginTop: 8,
            opacity: nameIn,
            transform: `translateY(${(1 - nameIn) * 34}px)`,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 600,
            color: accent,
            marginTop: 22,
            textAlign: 'center',
            opacity: titleIn,
            transform: `translateY(${(1 - titleIn) * 26}px)`,
          }}
        >
          {title}
        </div>
        {summary ? (
          <div
            style={{
              fontSize: 34,
              color: theme.subtext,
              marginTop: 36,
              textAlign: 'center',
              maxWidth: 780,
              lineHeight: 1.42,
              opacity: sumIn,
            }}
          >
            {summary}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
