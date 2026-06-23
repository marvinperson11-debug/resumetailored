// Remotion entry point. This file registers the root component that lists
// every available video Composition. It is used by both the Remotion Studio
// (`npm run remotion:studio`) and server-side rendering (remotion/render.js).
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
