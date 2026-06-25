import React from 'react';
import { Composition } from 'remotion';
import { ResumeVideo } from './ResumeVideo';
import { defaultResumeVideoProps, sceneFrames, FPS, HIRED_SECONDS } from './data';

const HIRED_FRAMES = Math.round(HIRED_SECONDS * FPS);

// 1080x1920 (9:16) — vertical format optimised for LinkedIn, Shorts, Reels
// and Stories, the channels job seekers actually share to.
const WIDTH = 1080;
const HEIGHT = 1920;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ResumeVideo"
      component={ResumeVideo}
      durationInFrames={sceneFrames(defaultResumeVideoProps.highlights.length, FPS).total + HIRED_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultResumeVideoProps}
      calculateMetadata={({ props }) => ({
        durationInFrames:
          Math.max(
            sceneFrames(props.highlights.length, FPS).total,
            props.audioDurationInFrames || 0
          ) + HIRED_FRAMES,
      })}
    />
  );
};
