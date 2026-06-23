// Configuration for the Remotion CLI / Studio (`npm run remotion:studio` and
// `npm run remotion:render`). Server-side rendering in remotion/render.js does
// NOT read this file — it passes options directly to renderMedia().
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(1);
