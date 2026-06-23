import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

export const Intro: React.FC<{
  name: string;
  title: string;
  summary: string;
  accent: string;
}> = ({ name, title, summary, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const rule = spring({ frame, fps, config: { damping: 200 } });
  const nameIn = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const titleIn = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  const sumIn = spring({ frame: frame - 22, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', padding: 90 }}
    >
      <div
        style={{
          width: 130,
          height: 8,
          borderRadius: 4,
          backgroundColor: accent,
          marginBottom: 44,
          transform: `scaleX(${rule})`,
        }}
      />
      <div
        style={{
          fontSize: 100,
          fontWeight: 800,
          color: theme.text,
          textAlign: 'center',
          lineHeight: 1.04,
          opacity: nameIn,
          transform: `translateY(${(1 - nameIn) * 32}px)`,
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: 50,
          fontWeight: 600,
          color: accent,
          marginTop: 26,
          textAlign: 'center',
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 28}px)`,
        }}
      >
        {title}
      </div>
      {summary ? (
        <div
          style={{
            fontSize: 36,
            color: theme.subtext,
            marginTop: 44,
            textAlign: 'center',
            maxWidth: 780,
            lineHeight: 1.42,
            opacity: sumIn,
          }}
        >
          {summary}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
