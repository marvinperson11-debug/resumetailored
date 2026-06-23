import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { ResumeVideoProps } from './types';
import { sceneFrames } from './data';
import { theme } from './theme';
import { Background } from './scenes/Background';
import { Intro } from './scenes/Intro';
import { Highlights } from './scenes/Highlights';
import { Skills } from './scenes/Skills';
import { Outro } from './scenes/Outro';

export const ResumeVideo: React.FC<ResumeVideoProps> = (props) => {
  const { fps } = useVideoConfig();
  const f = sceneFrames(props.highlights.length, fps);
  const accent = props.accentColor || theme.primary;
  // Stretch the outro to fill any extra time when the voiceover runs longer
  // than the scene timeline, so the video ends with the narration.
  const total = Math.max(f.total, props.audioDurationInFrames || 0);
  const outroDuration = total - (f.intro + f.highlights + f.skills);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.fontFamily }}>
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      <Background accent={accent} />

      <Sequence durationInFrames={f.intro} name="Intro">
        <Intro
          name={props.name}
          title={props.title}
          summary={props.summary}
          accent={accent}
        />
      </Sequence>

      <Sequence from={f.intro} durationInFrames={f.highlights} name="Highlights">
        <Highlights highlights={props.highlights} accent={accent} />
      </Sequence>

      <Sequence
        from={f.intro + f.highlights}
        durationInFrames={f.skills}
        name="Skills"
      >
        <Skills skills={props.skills} accent={accent} />
      </Sequence>

      <Sequence
        from={f.intro + f.highlights + f.skills}
        durationInFrames={outroDuration}
        name="Outro"
      >
        <Outro brand={props.brand} accent={accent} />
      </Sequence>
    </AbsoluteFill>
  );
};
