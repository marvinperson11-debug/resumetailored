import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { ResumeVideoProps, NarrationSegment } from './types';
import { sceneFrames, outroText, syncedTotalFrames } from './data';
import { theme, applyThemeFor } from './theme';
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
  // A user-chosen background colour (and the matching light/dark text) applies to the whole video. With none,
  // the theme is reset to the site's own look.
  const bgColor = applyThemeFor(props.backgroundColor);
  // Headshot overlay (draggable position from the app): shown on the title slide only, or on every slide.
  const overlay = props.photoUrl && props.photoOverlay ? props.photoOverlay : null;

  return (
    <AbsoluteFill style={{ backgroundColor: bgColor, fontFamily: theme.fontFamily }}>
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      {/* Quiet background jingle, mixed well under the voice. */}
      {props.musicSrc ? <Audio src={props.musicSrc} volume={0.12} loop /> : null}
      <Background accent={accent} base={props.backgroundColor ? bgColor : undefined} />
      {segments ? (
        <SyncedScenes props={props} segments={segments} accent={accent} fps={fps} />
      ) : (
        <FixedScenes props={props} accent={accent} fps={fps} />
      )}
      {/* Small persistent brand mark, bottom-right — not a full-screen splash. */}
      <Watermark brand={props.brand} accent={accent} />
      {/* Small persistent headshot, top-left — shown whenever a photo was uploaded. */}
      {overlay ? (
        overlay.everySlide ? <PhotoBadge photoUrl={props.photoUrl} accent={accent} position={overlay} /> : null
      ) : (
        <PhotoBadge photoUrl={props.photoUrl} accent={accent} />
      )}
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
        return <Greeting recipientName={props.recipientName || ''} recipientTitle={props.recipientTitle} accent={accent} lang={props.lang} />;
      case 'intro':
        return <Intro name={props.name} title={props.title} summary="" accent={accent} photoUrl={props.photoUrl} lang={props.lang} />;
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
  const f = sceneFrames(props.highlights.length, fps, props.quick);
  const overlay = props.photoUrl && props.photoOverlay ? props.photoOverlay : null;
  // Slides follow the narration (TTS timestamps) when sceneStarts is given, else the fixed timeline.
  const synced = Array.isArray(props.sceneStarts) && props.sceneStarts.length === 4 ? props.sceneStarts : null;
  let introF = f.intro, highlightsF = f.highlights, skillsF = f.skills;
  let total = Math.max(f.total, props.audioDurationInFrames || 0);
  if (synced) {
    const s = synced.map((x) => Math.round(x * fps));
    introF = Math.max(1, s[1] - s[0]);
    highlightsF = Math.max(1, s[2] - s[1]);
    skillsF = Math.max(1, s[3] - s[2]);
    total = syncedTotalFrames(synced, props.audioDurationInFrames, fps);
  }
  const outroDuration = Math.max(1, total - (introF + highlightsF + skillsF));

  return (
    <>
      <Sequence durationInFrames={introF} name="Intro">
        <Intro name={props.name} title={props.title} summary={props.summary} accent={accent} photoUrl={overlay ? undefined : props.photoUrl} lang={props.lang} />
        {/* Overlay headshot, title slide only (the every-slide variant is mounted for the whole video above). */}
        {overlay && !overlay.everySlide ? <PhotoBadge photoUrl={props.photoUrl} accent={accent} position={overlay} /> : null}
      </Sequence>
      <Sequence from={introF} durationInFrames={highlightsF} name="Highlights">
        <Highlights highlights={props.highlights} accent={accent} quick={props.quick} />
      </Sequence>
      <Sequence from={introF + highlightsF} durationInFrames={skillsF} name="Skills">
        <Skills skills={props.skills} accent={accent} />
      </Sequence>
      <Sequence
        from={introF + highlightsF + skillsF}
        durationInFrames={outroDuration}
        name="Outro"
      >
        <Outro text={outroText(props.outro, props.lang)} name={props.name} accent={accent} />
      </Sequence>
    </>
  );
};
