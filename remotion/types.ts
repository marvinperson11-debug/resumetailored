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
  // Optional recipient the video is addressed to (e.g. the hiring manager). When
  // present, the video opens with "Hi <name>, <title>." before the candidate intro.
  recipientName?: string;
  recipientTitle?: string;
  // Optional closing line the candidate speaks at the end (preset key or custom
  // text). Resolved to the spoken/shown text in data.js (outroText).
  outro?: string;
};

export type NarrationSegment = {
  kind: 'greeting' | 'intro' | 'summary' | 'highlight' | 'skills' | 'brand' | 'outro';
  index?: number; // highlight number (kind === 'highlight')
  text: string;
  start: number; // seconds
  end: number; // seconds
};
