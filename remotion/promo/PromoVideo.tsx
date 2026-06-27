import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { theme } from '../theme';
import { Background } from '../scenes/Background';
import { TitleCard } from './scenes/TitleCard';
import { ScreenshotScene } from './scenes/ScreenshotScene';
import { ClosingCard } from './scenes/ClosingCard';
import { promoSceneFrames, promoScreenshots, promoCaptions } from './data';

// Marketing/promo video for resumetailored.com — built from real screenshots
// of the live site with continuous motion (Ken Burns) and clean cuts, instead
// of AI-generated "actor" stock clips with fake illegible UI text and long
// frozen stills.
export const PromoVideo: React.FC<{ accentColor?: string }> = ({ accentColor }) => {
  const accent = accentColor || theme.primary;
  const f = promoSceneFrames;

  let cursor = 0;
  const titleStart = cursor;
  cursor += f.title;
  const heroStart = cursor;
  cursor += f.hero;
  const dashboardStart = cursor;
  cursor += f.dashboard;
  const videoStart = cursor;
  cursor += f.video;
  const outroStart = cursor;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.fontFamily }}>
      <Background accent={accent} />

      <Sequence from={titleStart} durationInFrames={f.title}>
        <TitleCard durationInFrames={f.title} />
      </Sequence>

      <Sequence from={heroStart} durationInFrames={f.hero}>
        <ScreenshotScene
          src={promoScreenshots.hero}
          caption={promoCaptions.hero}
          durationInFrames={f.hero}
          accent={accent}
          zoomDirection="in"
        />
      </Sequence>

      <Sequence from={dashboardStart} durationInFrames={f.dashboard}>
        <ScreenshotScene
          src={promoScreenshots.dashboard}
          caption={promoCaptions.dashboard}
          durationInFrames={f.dashboard}
          accent={accent}
          zoomDirection="out"
        />
      </Sequence>

      <Sequence from={videoStart} durationInFrames={f.video}>
        <ScreenshotScene
          src={promoScreenshots.video}
          caption={promoCaptions.video}
          durationInFrames={f.video}
          accent={accent}
          zoomDirection="in"
        />
      </Sequence>

      <Sequence from={outroStart} durationInFrames={f.outro}>
        <ClosingCard accent={accent} />
      </Sequence>
    </AbsoluteFill>
  );
};
