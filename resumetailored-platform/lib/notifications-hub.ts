/**
 * In-app notifications — shared types and event-type constants (no DB, no
 * network). Mirrors the `employee-hub.ts` convention. The DB column is free
 * text (not a Postgres enum), so these constants are the single source of
 * truth for callers logging an event and the bell UI picking an icon —
 * nothing validates against them at write time because every call site is
 * our own code, never user input.
 */

export const NOTIFICATION_TYPES = [
  "training_assigned",
  "training_completed",
  "message_received",
  "announcement_posted",
  "time_off_requested",
  "time_off_decided",
  "timesheet_submitted",
  "timesheet_decided",
  "schedule_published",
  "cert_expiring",
  "invite_accepted",
  "feed_post",
  "feed_comment",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Structured form of an event's title: a message id under
 *  `notificationBell.events.*` plus its parameters, so the bell can render it
 *  in the viewer's language. Dates are ISO (`YYYY-MM-DD`) and times `HH:MM`;
 *  the bell formats them for the locale. `title` stays as the English fallback. */
export interface NotificationMsg {
  key: string;
  params?: Record<string, string | number>;
}

export type NotificationAudience = "employer" | "employee";

export interface ActivityEvent {
  id: number;
  audience: NotificationAudience;
  employeeId: number | null;
  eventType: NotificationType | string;
  title: string;
  body: string | null;
  link: string;
  /** Null for events logged before structured messages (render `title`). */
  msg: NotificationMsg | null;
  createdAt: string;
}

export interface NotificationItem extends ActivityEvent {
  read: boolean;
}

export interface LogActivityInput {
  eventType: NotificationType;
  title: string;
  /** Translatable form of `title`; see `NotificationMsg`. */
  msg?: NotificationMsg;
  body?: string;
  link: string;
}
