import React from 'react';
import { Composition } from 'remotion';
import { ResumeVideo } from './ResumeVideo';
import { defaultResumeVideoProps, sceneFrames, FPS } from './data';
import { PromoVideo } from './promo/PromoVideo';
import { promoTotalFrames, PROMO_FPS } from './promo/data';

// 1080x1920 (9:16) — vertical format optimised for LinkedIn, Shorts, Reels
// and Stories, the channels job seekers actually share to.
const WIDTH = 1080;
const HEIGHT = 1920;

// 1920x1080 (16:9) — the promo video showcases real desktop UI screenshots,
// which need the extra width landscape gives them.
const PROMO_WIDTH = 1920;
const PROMO_HEIGHT = 1080;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ResumeVideo"
        component={ResumeVideo}
        durationInFrames={sceneFrames(defaultResumeVideoProps.highlights.length, FPS).total}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={defaultResumeVideoProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(
            sceneFrames(props.highlights.length, FPS).total,
            props.audioDurationInFrames || 0
          ),
        })}
      />
      <Composition
        id="PromoVideo"
        component={PromoVideo}
        durationInFrames={promoTotalFrames}
        fps={PROMO_FPS}
        width={PROMO_WIDTH}
        height={PROMO_HEIGHT}
        defaultProps={{ accentColor: '#6366F1' }}
      />
    </>
  );
};
