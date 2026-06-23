import React from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
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

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.fontFamily }}>
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
        durationInFrames={f.outro}
        name="Outro"
      >
        <Outro brand={props.brand} accent={accent} />
      </Sequence>
    </AbsoluteFill>
  );
};
