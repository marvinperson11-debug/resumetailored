import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { ResumeVideoProps, NarrationSegment } from './types';
import { sceneFrames, outroText } from './data';
import { theme } from './theme';
import { Background } from './scenes/Background';
import { Greeting } from './scenes/Greeting';
import { Intro } from './scenes/Intro';
import { Summary } from './scenes/Summary';
import { Highlights } from './scenes/Highlights';
import { HighlightOne } from './scenes/HighlightOne';
import { Skills } from './scenes/Skills';
import { Outro } from './scenes/Outro';
import { Watermark } from './scenes/Watermark';
import { PhotoBadge } from './scenes/PhotoBadge';

export const ResumeVideo: React.FC<ResumeVideoProps> = (props) => {
  const { fps } = useVideoConfig();
  const accent = props.accentColor || theme.primary;
  const segments = props.segments && props.segments.length ? props.segments : null;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily: theme.fontFamily }}>
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      {/* Quiet background jingle, mixed well under the voice. */}
      {props.musicSrc ? <Audio src={props.musicSrc} volume={0.12} loop /> : null}
      <Background accent={accent} />
      {segments ? (
        <SyncedScenes props={props} segments={segments} accent={accent} fps={fps} />
      ) : (
        <FixedScenes props={props} accent={accent} fps={fps} />
      )}
      {/* Small persistent brand mark, bottom-right — not a full-screen splash. */}
      <Watermark brand={props.brand} accent={accent} />
      {/* Small persistent headshot, top-left — shown whenever a photo was uploaded. */}
      <PhotoBadge photoUrl={props.photoUrl} accent={accent} />
    </AbsoluteFill>
  );
};

// ── Reveal-as-spoken path: one scene per narration segment, shown exactly while
// that line is voiced (start/end times come from the TTS). ───────────────────
const SyncedScenes: React.FC<{
  props: ResumeVideoProps;
  segments: NarrationSegment[];
  accent: string;
  fps: number;
}> = ({ props, segments, accent, fps }) => {
  // Monotonic per-segment start frames; each scene runs until the next starts.
  const startF: number[] = [];
  segments.forEach((s, i) => {
    const f = Math.max(0, Math.round(s.start * fps));
    startF[i] = i === 0 ? f : Math.max(f, startF[i - 1] + 1);
  });
  const lastEnd = Math.round((segments[segments.length - 1]?.end || 0) * fps);
  const totalF = Math.max(
    props.audioDurationInFrames || 0,
    lastEnd,
    startF[startF.length - 1] + fps,
  );
  const hlTotal = segments.filter((s) => s.kind === 'highlight').length;

  const sceneFor = (seg: NarrationSegment) => {
    switch (seg.kind) {
      case 'greeting':
        return <Greeting recipientName={props.recipientName || ''} recipientTitle={props.recipientTitle} accent={accent} />;
      case 'intro':
        return <Intro name={props.name} title={props.title} summary="" accent={accent} photoUrl={props.photoUrl} />;
      case 'summary':
        return <Summary summary={props.summary} accent={accent} />;
      case 'highlight':
        return (
          <HighlightOne
            text={props.highlights[seg.index ?? 0] || seg.text}
            index={seg.index ?? 0}
            total={hlTotal}
            accent={accent}
          />
        );
      case 'skills':
        return <Skills skills={props.skills} accent={accent} />;
      case 'outro':
        return <Outro text={seg.text} name={props.name} accent={accent} />;
      default:
        return null;
    }
  };

  return (
    <>
      {segments.map((seg, i) => {
        const from = startF[i];
        const to = i < segments.length - 1 ? startF[i + 1] : totalF;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, to - from)} name={seg.kind}>
            {sceneFor(seg)}
          </Sequence>
        );
      })}
    </>
  );
};

// ── Fallback path (Studio / no narration timings): the original fixed-duration
// scene timeline, with the outro stretched to fill any extra audio. ───────────
const FixedScenes: React.FC<{ props: ResumeVideoProps; accent: string; fps: number }> = ({
  props,
  accent,
  fps,
}) => {
  const f = sceneFrames(props.highlights.length, fps);
  const total = Math.max(f.total, props.audioDurationInFrames || 0);
  const outroDuration = total - (f.intro + f.highlights + f.skills);

  return (
    <>
      <Sequence durationInFrames={f.intro} name="Intro">
        <Intro name={props.name} title={props.title} summary={props.summary} accent={accent} photoUrl={props.photoUrl} />
      </Sequence>
      <Sequence from={f.intro} durationInFrames={f.highlights} name="Highlights">
        <Highlights highlights={props.highlights} accent={accent} />
      </Sequence>
      <Sequence from={f.intro + f.highlights} durationInFrames={f.skills} name="Skills">
        <Skills skills={props.skills} accent={accent} />
      </Sequence>
      <Sequence
        from={f.intro + f.highlights + f.skills}
        durationInFrames={outroDuration}
        name="Outro"
      >
        <Outro text={outroText(props.outro)} name={props.name} accent={accent} />
      </Sequence>
    </>
  );
};
