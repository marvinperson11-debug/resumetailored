// Shared shapes for the structured resume, preferences, and AI outputs.
// These are the JSON payloads stored in User.resumeData / JobApplication.*.

export interface PersonalInfo {
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  portfolio?: string;
  website?: string;
}

export interface WorkExperience {
  company: string;
  title: string;
  location?: string;
  startDate?: string; // "2021-03" or "Mar 2021"
  endDate?: string; // "Present" allowed
  current?: boolean;
  bullets: string[];
}

export interface Education {
  school: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
}

export interface ResumeData {
  personalInfo: PersonalInfo;
  summary?: string;
  workExperience: WorkExperience[];
  education: Education[];
  skills: string[];
  certifications?: string[];
  preferredSalary?: string;
  startDate?: string; // availability
}

export type WorkMode = "remote" | "hybrid" | "onsite" | "any";

export interface JobPreferences {
  role?: string;
  location?: string;
  workMode?: WorkMode;
  minSalary?: number;
}

export interface MatchResult {
  score: number; // 0–100
  summary: string;
  breakdown: {
    skills: number; // 0–100
    experience: number; // 0–100
    domain: number; // 0–100
  };
  missingKeywords: string[];
}

export interface SuggestedAnswer {
  question: string;
  answer: string;
}

export interface PreparedApplication {
  tailoredResume: ResumeData; // same shape, optimized bullets
  coverLetter: string;
  suggestedAnswers: SuggestedAnswer[];
}

/**
 * Flat payload the extension consumes. Everything an ATS form could ask for,
 * pre-resolved so the content script never has to reason about resume shape.
 */
export interface ApplyData {
  jobApplicationId: string;
  company: string;
  role: string;
  jobUrl: string;
  status: string;
  personal: PersonalInfo;
  workExperience: WorkExperience[];
  education: Education[];
  skills: string[];
  coverLetter: string | null;
  suggestedAnswers: SuggestedAnswer[];
  preferredSalary: string | null;
  startDate: string | null;
}
