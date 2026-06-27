// Single source of truth for the marketing/promo video — timing + copy.
// This is a separate composition from ResumeVideo (which renders a *candidate's*
// personalized resume); this one promotes the resumetailored.com product itself
// using real screenshots of the live site instead of stock/AI-generated footage.

export const PROMO_FPS = 30;

export const promoSceneFrames = {
  title: Math.round(2.2 * PROMO_FPS),
  hero: Math.round(4 * PROMO_FPS),
  dashboard: Math.round(4 * PROMO_FPS),
  video: Math.round(4 * PROMO_FPS),
  outro: Math.round(3.6 * PROMO_FPS),
};

export const promoTotalFrames =
  promoSceneFrames.title +
  promoSceneFrames.hero +
  promoSceneFrames.dashboard +
  promoSceneFrames.video +
  promoSceneFrames.outro;

export const promoScreenshots = {
  hero: 'promo/hero.png',
  dashboard: 'promo/app-dashboard.png',
  video: 'promo/video-feature.png',
};

export const promoCaptions = {
  hero: 'Paste your resume + a job posting.',
  dashboard: 'AI rewrites it with the right keywords — in seconds.',
  video: 'Even turn it into a video for LinkedIn.',
};
