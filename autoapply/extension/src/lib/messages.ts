// Message protocol shared across the extension's contexts.

export interface Assignment {
  jobId: string;
  jobUrl: string;
  apiBase: string;
}

// page (dashboard) → dashboard-bridge → background
export interface ApplyMessage extends Assignment {
  type: "APPLY";
}

// ats content script → background: "what job am I filling?"
export interface GetAssignmentMessage {
  type: "GET_ASSIGNMENT";
}

// ats content script → background: clear once consumed
export interface ClearAssignmentMessage {
  type: "CLEAR_ASSIGNMENT";
}

export type BackgroundMessage = ApplyMessage | GetAssignmentMessage | ClearAssignmentMessage;

export interface AssignmentResponse {
  assignment: Assignment | null;
}
