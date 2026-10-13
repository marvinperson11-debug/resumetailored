/**
 * Launch flag for the in-portal employer resume viewer (PDF.js + annotations).
 *
 * OFF by default, and it stays off until the fidelity gate passes on a corpus that includes REAL
 * exports — see RESUME_VIEWER.md and fidelity/report.json. It is a source constant rather than an
 * environment variable on purpose (this feature adds no env vars), so turning it on is a reviewed
 * one-line change, and scripts/test-resume-fidelity.cjs fails the build if this is `true` while the
 * committed gate report says the mangled-resume rate is above the limit.
 *
 * When off, the feature is absent everywhere: the candidate drawer renders no viewer section, the demo
 * pipeline has no "view resume" action, and every /api/employer/candidates/[id]/resume* route answers 404.
 */
export const RESUME_VIEWER_ENABLED = false;

export function resumeViewerEnabled(): boolean {
  return RESUME_VIEWER_ENABLED;
}
