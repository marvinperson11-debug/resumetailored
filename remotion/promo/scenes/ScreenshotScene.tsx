import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { theme } from '../../theme';

// Shows one real screenshot of the live site with a slow continuous Ken Burns
// drift (never a frozen still) inside a browser-chrome mockup, plus a caption.
// Replaces the AI-generated "actor at a laptop" clips, which rendered fake,
// illegible UI text and read as cheap stock footage.
export const ScreenshotScene: React.FC<{
  src: string;
  caption: string;
  durationInFrames: number;
  accent: string;
  zoomDirection?: 'in' | 'out';
}> = ({ src, caption, durationInFrames, accent, zoomDirection = 'in' }) => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(fadeIn, fadeOut);

  const [scaleFrom, scaleTo] = zoomDirection === 'in' ? [1, 1.09] : [1.09, 1];
  const scale = interpolate(frame, [0, durationInFrames], [scaleFrom, scaleTo], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const panX = interpolate(frame, [0, durationInFrames], [0, -18], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const captionIn = interpolate(frame, [10, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          position: 'absolute',
          top: 70,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '84%',
          borderRadius: 18,
          overflow: 'hidden',
          border: `1px solid ${accent}66`,
          boxShadow: `0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)`,
          background: '#0b1020',
        }}
      >
        {/* Fake browser chrome bar so a flat screenshot reads as a live product, not a still image. */}
        <div
          style={{
            height: 34,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 14px',
            background: '#11162a',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
          ))}
          <div
            style={{
              marginLeft: 12,
              fontSize: 12,
              color: theme.subtext,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 6,
              padding: '3px 12px',
            }}
          >
            resumetailored.com
          </div>
        </div>
        {/* Fixed height + objectFit cover so every screenshot (whatever its own
            aspect ratio) renders at the same card size, leaving guaranteed
            room below for the caption instead of pushing it off-frame. */}
        <div style={{ height: 660, overflow: 'hidden' }}>
          <Img
            src={staticFile(src)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'top',
              display: 'block',
              transform: `scale(${scale}) translateX(${panX}px)`,
              transformOrigin: 'center top',
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: '50%',
          transform: `translate(-50%, ${(1 - captionIn) * 16}px)`,
          opacity: captionIn,
          background: 'rgba(3,7,18,0.82)',
          border: `1px solid ${accent}55`,
          borderRadius: 14,
          padding: '16px 32px',
          maxWidth: '70%',
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 600, color: theme.text, textAlign: 'center' }}>{caption}</div>
      </div>
    </AbsoluteFill>
  );
};
