import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { theme } from '../theme';

// Opens the video by addressing the recipient it's being sent to, e.g.
// "Hi  /  Mr. Smith  /  Hiring Manager".
export const Greeting: React.FC<{
  recipientName: string;
  recipientTitle?: string;
  accent: string;
}> = ({ recipientName, recipientTitle, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hiIn = spring({ frame, fps, config: { damping: 200 } });
  const nameIn = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  const titleIn = spring({ frame: frame - 16, fps, config: { damping: 200 } });
  const float = Math.sin(frame / 16) * 8;

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 90, flexDirection: 'column' }}>
      <div style={{ transform: `translateY(${float}px)`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 56, color: theme.subtext, opacity: hiIn, letterSpacing: 1 }}>Hi</div>
        <div
          style={{
            fontSize: 100,
            fontWeight: 800,
            color: theme.text,
            textAlign: 'center',
            lineHeight: 1.04,
            marginTop: 10,
            opacity: nameIn,
            transform: `translateY(${(1 - nameIn) * 32}px)`,
          }}
        >
          {recipientName}
        </div>
        {recipientTitle ? (
          <div
            style={{
              fontSize: 48,
              fontWeight: 600,
              color: accent,
              marginTop: 20,
              textAlign: 'center',
              opacity: titleIn,
              transform: `translateY(${(1 - titleIn) * 24}px)`,
            }}
          >
            {recipientTitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
