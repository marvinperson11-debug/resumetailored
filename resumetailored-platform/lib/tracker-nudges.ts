import { checkDwellNudge, buildNudgeMessage, type TrackerStage } from "./tracker-core";
import { listTrackedApplications, listEvents, lastEventAt, logEvent, type TrackedApplication } from "./tracker-store";

/**
 * Application Tracker — stage-dwell nudge orchestration (Combined Build,
 * Section 1). Thin glue between the pure decision in lib/tracker-core.ts and
 * the DB reads/writes in lib/tracker-store.ts, kept in its own file so the
 * pure logic stays importable with no DB at all.
 */

export interface DueNudge {
  application: TrackedApplication;
  stage: TrackerStage;
  daysDwelling: number;
  message: string;
}

/** The reference time a dwell nudge for this application should be measured
 *  from: for "Applied" that's simply when it entered the stage; for
 *  "Interviewing" the spec calls for "7d post-last-event", so this prefers
 *  the most recent substantive application_events row, falling back to
 *  stageChangedAt when there isn't one yet. */
async function referenceTimeFor(app: TrackedApplication, userId: string): Promise<string> {
  if (app.stage === "Interviewing") {
    const last = await lastEventAt(userId, app.id);
    if (last) return last;
  }
  return app.stageChangedAt;
}

/** Find the referenceTime of the most recent nudge_fired/nudge_dismissed
 *  event for this application, so a dismissed nudge stays dismissed until
 *  the reference time actually changes (new stage entry or new activity) —
 *  never re-shown for the SAME dwell window it was already dismissed for. */
async function nudgeHistory(userId: string, trackedApplicationId: string): Promise<{ lastFired: string | null; lastDismissed: string | null }> {
  const events = await listEvents(userId, trackedApplicationId, 20);
  let lastFired: string | null = null;
  let lastDismissed: string | null = null;
  for (const e of events) {
    if (e.event === "nudge_fired" && !lastFired) lastFired = (e.payload.referenceTime as string) || null;
    if (e.event === "nudge_dismissed" && !lastDismissed) lastDismissed = (e.payload.referenceTime as string) || null;
    if (lastFired && lastDismissed) break;
  }
  return { lastFired, lastDismissed };
}

/** All nudges due right now for the signed-in candidate's board. Logs a
 *  `nudge_fired` event (once per stage-entry/reference, per
 *  lib/tracker-core.ts's idempotency rule) for every nudge newly surfaced
 *  this call — a repeat call within the same dwell window returns the same
 *  nudge again (so it keeps showing until dismissed) without logging a
 *  second `nudge_fired` row. A nudge already dismissed for its current
 *  reference time is excluded. */
export async function getDueNudges(userId: string): Promise<DueNudge[]> {
  const apps = await listTrackedApplications(userId);
  const due: DueNudge[] = [];
  for (const app of apps) {
    if (app.nudgesOff) continue;
    const referenceTime = await referenceTimeFor(app, userId);
    const { lastFired, lastDismissed } = await nudgeHistory(userId, app.id);
    if (lastDismissed === referenceTime) continue;
    const check = checkDwellNudge({ stage: app.stage, referenceTime, nudgesOff: app.nudgesOff }, Date.now());
    if (!check.due) continue;
    if (lastFired !== referenceTime) {
      await logEvent(userId, app.id, "nudge_fired", { referenceTime, stage: app.stage, daysDwelling: check.daysDwelling });
    }
    due.push({ application: app, stage: check.stage, daysDwelling: check.daysDwelling, message: buildNudgeMessage(check.stage, app.company, app.jobTitle, check.daysDwelling) });
  }
  return due;
}

/** Dismiss the currently-due nudge for one tracked application — logs
 *  `nudge_dismissed` against the SAME reference time the nudge fired for,
 *  so it stays dismissed until that reference time actually changes. */
export async function dismissNudge(userId: string, trackedApplicationId: string): Promise<boolean> {
  const apps = await listTrackedApplications(userId);
  const app = apps.find((a) => a.id === trackedApplicationId);
  if (!app) return false;
  const referenceTime = await referenceTimeFor(app, userId);
  await logEvent(userId, trackedApplicationId, "nudge_dismissed", { referenceTime, stage: app.stage });
  return true;
}
