// Single source of truth for the marketing/promo video — timing + copy.
// This is a separate composition from ResumeVideo (which renders a *candidate's*
// personalized resume); this one promotes the resumetailored.com product itself
// using real screenshots of the live site instead of stock/AI-generated footage.
//
// The video leads with a quick mention of AI tailoring, then spends most of its
// runtime on the resume-video generator (the feature being advertised), closing
// with a CTA. The "video" scene's on-screen duration stretches to fit however
// long the voiceover actually runs (see PromoVideo.tsx) — these are just the
// planned/minimum lengths.

export const PROMO_FPS = 30;

export const promoSceneFrames = {
  title: Math.round(2.2 * PROMO_FPS),
  hero: Math.round(3.4 * PROMO_FPS),
  video: Math.round(7 * PROMO_FPS),
  outro: Math.round(4 * PROMO_FPS),
};

export const promoTotalFrames =
  promoSceneFrames.title + promoSceneFrames.hero + promoSceneFrames.video + promoSceneFrames.outro;

export const promoScreenshots = {
  hero: 'promo/hero.png',
  video: 'promo/video-feature.png',
};

export const promoCaptions = {
  hero: 'AI tailors your resume to any job in seconds.',
  video: 'Then turn it into a video resume — AI voiceover, addressed to the hiring manager by name.',
};

// Spoken voiceover for the promo video — kept here so narration timing tracks
// the same copy as the on-screen captions. Mostly about the resume-video
// generator (what this promo is advertising); the resume/cover-letter tailoring
// gets a brief mention up front.
export const promoNarrationScript =
  "Stand out before they even open your resume. ResumeTailored AI rewrites your resume for any job in seconds. " +
  "But here's the real difference: turn that tailored resume into a short video resume. Our AI writes the voiceover, " +
  'addresses the hiring manager by name, and exports it ready for LinkedIn, Shorts, and Reels. ' +
  'Build your resume free at resumetailored dot com.';
