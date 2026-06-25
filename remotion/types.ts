// Shape of the props accepted by the ResumeVideo composition. The runtime
// values (defaults + timing) live in ./data.js so the Node server can share
// them; this file only carries the TypeScript type.
export type ResumeVideoProps = {
  name: string;
  title: string;
  summary: string;
  highlights: string[];
  skills: string[];
  accentColor: string;
  brand: string;
  // Optional voiceover track (data/HTTP URL). When present it is muxed into the
  // rendered MP4. Absent in Studio/default props, so the video stays silent.
  audioSrc?: string;
  // When the narration is longer than the scene timeline, the video is extended
  // to this many frames so the whole voiceover is heard.
  audioDurationInFrames?: number;
  // Per-segment narration timings. When present, each scene is revealed exactly
  // while its line is spoken (instead of the fixed scene durations).
  segments?: NarrationSegment[];
  // Optional candidate photo (data/HTTP URL). Shown as a circular avatar in the
  // intro when present.
  photoUrl?: string;
  // Optional quiet background music track (data/HTTP URL), muxed under the voice.
  musicSrc?: string;
};

export type NarrationSegment = {
  kind: 'intro' | 'summary' | 'highlight' | 'skills' | 'brand';
  index?: number; // highlight number (kind === 'highlight')
  text: string;
  start: number; // seconds
  end: number; // seconds
};
