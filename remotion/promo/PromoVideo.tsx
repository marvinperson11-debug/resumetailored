import React from 'react';
import { AbsoluteFill, Audio, Sequence } from 'remotion';
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
export const PromoVideo: React.FC<{
  accentColor?: string;
  audioSrc?: string;
  musicSrc?: string;
  audioDurationInFrames?: number;
}> = ({ accentColor, audioSrc, musicSrc, audioDurationInFrames }) => {
  const accent = accentColor || theme.primary;
  const f = promoSceneFrames;

  // The video-generator scene is the focus of this promo and absorbs any extra
  // frames needed so the voiceover never gets cut off; title/hero/outro keep
  // their planned lengths.
  const videoDuration = Math.max(f.video, (audioDurationInFrames || 0) - (f.title + f.hero + f.outro));

  let cursor = 0;
  const titleStart = cursor;
  cursor += f.title;
  const heroStart = cursor;
  cursor += f.hero;
  const videoStart = cursor;
  cursor += videoDuration;
  const outroStart = cursor;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.fontFamily }}>
      {audioSrc ? <Audio src={audioSrc} /> : null}
      {/* Quiet background jingle, mixed well under the voice. */}
      {musicSrc ? <Audio src={musicSrc} volume={0.12} loop /> : null}
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

      <Sequence from={videoStart} durationInFrames={videoDuration}>
        <ScreenshotScene
          src={promoScreenshots.video}
          caption={promoCaptions.video}
          durationInFrames={videoDuration}
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
