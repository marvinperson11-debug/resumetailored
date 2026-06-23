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
};
