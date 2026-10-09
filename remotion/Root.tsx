import React from 'react';
import { Composition } from 'remotion';
import { ResumeVideo } from './ResumeVideo';
import { defaultResumeVideoProps, sceneFrames, syncedTotalFrames, FPS } from './data';

// 1080x1920 (9:16) — vertical format optimised for LinkedIn, Shorts, Reels
// and Stories, the channels job seekers actually share to.
const WIDTH = 1080;
const HEIGHT = 1920;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ResumeVideo"
      component={ResumeVideo}
      durationInFrames={sceneFrames(defaultResumeVideoProps.highlights.length, FPS).total}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultResumeVideoProps}
      calculateMetadata={({ props }) => ({
        // Slides driven by TTS timestamps: the video is the narration plus a short hold on the close.
        // Otherwise the original rule (the fixed timeline, stretched to fit a longer voiceover).
        durationInFrames: props.sceneStarts
          ? syncedTotalFrames(props.sceneStarts, props.audioDurationInFrames, FPS)
          : Math.max(
              sceneFrames(props.highlights.length, FPS, props.quick).total,
              props.audioDurationInFrames || 0
            ),
      })}
    />
  );
};
