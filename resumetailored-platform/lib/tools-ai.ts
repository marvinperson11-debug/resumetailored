/**
 * Prompt builders + validators for the Phase-2 candidate tools (LinkedIn
 * Optimizer, Interview Coach, Career Hub, Decoder Key). Ported/adapted from the
 * old site (server.js `/api/optimize-linkedin`, tools-core.js
 * `buildJobDecodePrompt`, interview-coach.js `buildFeedbackPrompt`). Model:
 * claude-sonnet-4-6, same as the rest of the app.
 *
 * The AI tools that return structured data ask for strict JSON; `extractJson`
 * tolerates ```json fences and leading/trailing prose.
 */

export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const match = body.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

// ─── LinkedIn Optimizer (verbatim port of /api/optimize-linkedin) ─────────────
export function buildLinkedinPrompt(args: { profileText: string; targetRole: string; pro: boolean }): {
  system: string;
  user: string;
} {
  const { profileText, targetRole, pro } = args;
  const proSections = pro
    ? `

SKILLS TO ADD OR REMOVE
[A short list. Under "Add:" name 5–8 skills/keywords from the target role the profile is missing. Under "Remove:" name any dated or diluting skills to drop. One skill per line.]

KEYWORD DENSITY ANALYSIS
[List the 6–8 most important keywords a recruiter searches for this role, each with a one-word status — Strong / Present / Missing — based on the current profile, and a one-line note on where to add the Missing ones.]`
    : "";
  const system = `You are a LinkedIn profile strategist who has helped thousands of professionals land senior roles at top companies. You write LinkedIn copy that reads as genuinely human, avoids buzzwords, and is optimized for both the LinkedIn algorithm and real recruiters. Your output is always specific, achievement-oriented, and impossible to confuse with a generic AI-generated profile.`;
  const user = `## Task: Optimize this LinkedIn profile for the target role.

**Target Role:** ${targetRole}

**Analysis protocol (apply silently before writing):**
1. Extract the 4–5 keywords and phrases recruiters search when hiring for "${targetRole}"
2. Identify the candidate's 3 strongest proof points (metrics, scope, outcomes) from the profile text
3. Note any credibility signals (companies, tools, certifications) that should be prominent
4. Assess what the current profile is missing vs. best-in-class profiles for this role

**Output exactly these section headers (use them verbatim):**

OPTIMIZED HEADLINE
[Single line, max 220 characters. Format: [Strong Identity Statement] | [Key Skill 1] • [Key Skill 2] • [Key Skill 3]. Searchable keywords without sounding robotic. No emojis.]

OPTIMIZED ABOUT SECTION
[5–7 sentences, first-person, conversational but professional. Open with a specific hook (a result, a mission, or a distinctive POV — never "I am a seasoned professional"). Middle: 2–3 specific achievements with metrics. Close: what the candidate is focused on now. Under 2,000 characters. No buzzwords or clichés.]

OPTIMIZED EXPERIENCE BULLETS
[For each job detected in the profile, 3–4 rewritten bullets. Format:
**[Job Title] at [Company]**
• [Verb + outcome + metric or scope]
Each bullet starts with an ownership verb; never "Responsible for", "Helped", "Assisted", or "Worked on".]${proSections}

## Current LinkedIn Profile:
${profileText}

---
OUTPUT: LinkedIn Optimization (labeled sections only — no preamble or explanation)`;
  return { system, user };
}

// ─── Interview Coach — question generation ────────────────────────────────────
export interface InterviewQuestion {
  type: "behavioral" | "technical";
  question: string;
  framework?: string; // e.g. STAR, or what a strong answer covers
}

export function buildInterviewQuestionsPrompt(jobText: string, count: number): { system: string; user: string } {
  return {
    system:
      "You are an expert interview coach who has prepped candidates for roles at top companies. Output ONLY valid JSON, no markdown, no preamble.",
    user: `From the job description below, generate the ${count} most likely interview questions — a realistic mix of behavioral and technical questions specific to THIS role (not generic filler).

Return exactly this JSON:
{
  "questions": [
    { "type": "behavioral" | "technical", "question": "the question", "framework": "one short line on what a strong answer covers or which framework fits (e.g. STAR)" }
  ]
}

JOB DESCRIPTION:
${jobText.slice(0, 6000)}`,
  };
}

// ─── Interview Coach — answer feedback (port of interview-coach.js) ───────────
export interface InterviewFeedback {
  overall: number;
  scores: { structure: number; relevance: number; keywords: number };
  strengths: string[];
  improvements: string[];
  summary: string;
}

export function buildInterviewFeedbackPrompt(args: { question: string; answer: string; role?: string }): {
  system: string;
  user: string;
} {
  const { question, answer, role } = args;
  return {
    system:
      "You are a calm, professional interview coach. You give direct, specific, encouraging feedback on ONE interview answer. Score structure, relevance, and keyword coverage 0-5. Respond with ONLY a JSON object, no markdown.",
    user: `TARGET ROLE: ${(role || "general").slice(0, 120)}
QUESTION: ${question.slice(0, 500)}
CANDIDATE ANSWER: ${answer.slice(0, 4000) || "(empty)"}

Return exactly:
{
  "overall": <0-5>,
  "scores": { "structure": <0-5>, "relevance": <0-5>, "keywords": <0-5> },
  "strengths": ["<short, specific>"],
  "improvements": ["<short, actionable>"],
  "summary": "<one or two encouraging sentences>"
}`,
  };
}

// ─── Career Hub — path explorer + skill gap ───────────────────────────────────
export interface CareerRoadmap {
  paths: { title: string; why: string; timeline: string }[];
  skillsToLearn: string[];
  skillGap: { skill: string; have: boolean }[];
  roadmap: { phase: string; focus: string }[];
  resources: string[];
}

export function buildCareerPrompt(args: {
  currentRole: string;
  years: string;
  targetRole: string;
  pro: boolean;
}): { system: string; user: string } {
  const { currentRole, years, targetRole, pro } = args;
  return {
    system:
      "You are a senior career strategist and coach. You give concrete, realistic career guidance — named skills, real timelines, honest trade-offs. Output ONLY valid JSON, no markdown, no preamble.",
    user: `A professional is a ${currentRole} with ${years} years of experience${
      targetRole ? `, targeting: ${targetRole}` : ", unsure of their next step"
    }.

Return exactly this JSON:
{
  "paths": [ { "title": "a concrete next role/direction", "why": "one sentence why it fits", "timeline": "e.g. 12-18 months" } ],
  "skillsToLearn": ["the specific skills/tools to build, most important first"],
  "skillGap": [ { "skill": "skill name", "have": true|false } ],
  "roadmap": [ { "phase": "e.g. Months 0-3", "focus": "what to do in this phase" } ]${
    pro
      ? `,
  "resources": ["specific courses, certs, books, or communities worth pursuing"]`
      : `,
  "resources": []`
  }
}

Give 3 paths, 6-9 skills, an honest skillGap of 6-8 items, and a 3-4 phase roadmap.${
      pro ? " Include 4-6 concrete resources." : " Leave resources as an empty array."
    }`,
  };
}

// ─── Decoder Key (port of tools-core.js buildJobDecodePrompt) ─────────────────
export interface JobDecode {
  summary: string;
  seniority: string;
  mustHave: string[];
  niceToHave: string[];
  redFlags: string[];
  hiddenRequirements: string[];
  cultureSignals: string[];
  keywords: string[];
}

export function buildDecoderPrompt(jobText: string): { system: string; user: string } {
  return {
    system:
      "You are a candid career coach who reads job descriptions the way an experienced recruiter does. You surface what a job seeker cannot see on a first read: which requirements are truly mandatory vs. nice-to-have, euphemisms that hint at overwork, unstated must-haves, and culture signals. Be specific and honest but never cynical. Return ONLY a JSON object, no markdown.",
    user: `Analyze this job posting and return a JSON object with EXACTLY these keys:
{
  "summary": "2-sentence plain-language summary of the real role",
  "seniority": "one of: entry, mid, senior, lead, unclear",
  "mustHave": ["the genuinely required skills/experience — the dealbreakers"],
  "niceToHave": ["preferred/bonus items that are not dealbreakers"],
  "redFlags": ["short phrases — vague overtime language, unrealistic scope, churn signals; [] if none"],
  "hiddenRequirements": ["skills/experience implied but not stated as explicit requirements"],
  "cultureSignals": ["what the language reveals about how this team actually works"],
  "keywords": ["specific ATS keywords worth mirroring in a resume/profile"]
}

JOB POSTING:
${jobText.slice(0, 10000)}`,
  };
}
