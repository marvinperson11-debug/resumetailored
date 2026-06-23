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
};
