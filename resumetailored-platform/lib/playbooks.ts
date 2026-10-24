/**
 * Role playbooks for the Employer Portal AI Assistant (Prompt 5) — a
 * ready-made skeleton job post + screening questions + interview kit for a
 * handful of common roles, so an employer who says "I need to hire a
 * personal assistant" gets something useful to react to instead of a blank
 * page. The MODEL recognizes the trigger phrase (the tool description in
 * lib/assistant-tools.ts lists every key/title pair) and calls
 * start_job_from_playbook with the matching key — there is no code-level NLP
 * matcher here, same division of labor as every other tool (the model
 * decides, the code validates and executes).
 *
 * Wage fields are ALWAYS EMPTY — a playbook never pre-fills pay. The
 * pay-transparency publish gate (lib/job-publish-validation.ts) already
 * blocks publishing without it, and start_job_from_playbook never publishes
 * anyway (see lib/assistant-mutations.ts); the employer supplies pay through
 * the normal chip-answer flow, same as a freehand draft_job_post.
 *
 * Every screening/interview question here must be free of protected-class
 * content (age, religion, marital/family status, pregnancy, national
 * origin, disability) — scripts/test-employer-assistant.cjs runs every
 * question through PLAYBOOK_BANNED_PHRASES and fails if any matches, so this
 * file drifting toward an illegal screening question is caught in CI, not
 * just at review time.
 */

export interface JobPlaybook {
  key: string;
  /** Human label, e.g. "Personal Assistant" — shown on the card and listed
   *  in the tool description so the model can match the employer's words to
   *  a key. */
  title: string;
  /** Suggested job posting title — usually the same as `title`, kept
   *  separate in case a role's posting title should read differently. */
  jobTitle: string;
  skeletonDescription: string;
  /** 3-5 questions a candidate would answer before a resume is even reviewed. */
  screeningQuestions: string[];
  interviewKit: {
    /** 6-8 open-ended interview questions. */
    questions: string[];
    /** 4-6 short scorecard criteria a hiring manager rates a candidate against. */
    scorecard: string[];
  };
}

export const JOB_PLAYBOOKS: Record<string, JobPlaybook> = {
  "personal-assistant": {
    key: "personal-assistant",
    title: "Personal Assistant",
    jobTitle: "Personal Assistant",
    skeletonDescription:
      "We're looking for an organized, proactive Personal Assistant to support day-to-day scheduling, correspondence, errands, and office or household coordination. You'll manage calendars, handle calls and emails, coordinate appointments and travel, and keep projects and priorities on track. Strong communication, discretion, and the ability to anticipate needs are essential.",
    screeningQuestions: [
      "What scheduling or calendar-management tools have you used (e.g., Google Calendar, Outlook)?",
      "Describe a time you had to juggle multiple priorities for someone else — how did you decide what came first?",
      "Are you comfortable running errands that require a reliable vehicle and a valid driver's license?",
      "How do you typically handle confidential information or sensitive requests?",
    ],
    interviewKit: {
      questions: [
        "Walk me through a typical week supporting a busy executive or household — what did your day-to-day look like?",
        "Tell me about a time a schedule changed at the last minute. How did you handle it?",
        "How do you keep track of multiple ongoing tasks and deadlines?",
        "Describe a situation where you had to use discretion with sensitive information.",
        "What tools or systems do you rely on to stay organized?",
        "Tell me about a time you anticipated a need before being asked.",
        "How do you communicate when you're overloaded or a deadline is at risk?",
        "What does great support look like to you?",
      ],
      scorecard: ["Organization & time management", "Communication clarity", "Discretion & trustworthiness", "Proactivity — anticipates needs", "Adaptability under changing priorities"],
    },
  },
  "dental-hygienist": {
    key: "dental-hygienist",
    title: "Dental Hygienist",
    jobTitle: "Dental Hygienist",
    skeletonDescription:
      "Our dental practice is seeking a licensed Dental Hygienist to provide preventive oral care, including cleanings, exams, x-rays, and patient education. You'll work closely with our dentists and front-office team to deliver a comfortable, high-quality patient experience. A current dental hygiene license and strong clinical and interpersonal skills are required.",
    screeningQuestions: [
      "Do you currently hold an active dental hygiene license in this state?",
      "How many years of clinical hygiene experience do you have?",
      "Which practice management or charting software have you used (e.g., Dentrix, Eaglesoft, Open Dental)?",
      "Are you comfortable performing digital x-rays and intraoral scans?",
      "What is your availability for full-time or part-time scheduling?",
    ],
    interviewKit: {
      questions: [
        "Walk me through your typical cleaning and exam workflow with a patient.",
        "How do you handle an anxious or uncomfortable patient?",
        "Tell me about a time you identified something during an exam that the dentist needed to follow up on.",
        "How do you approach patient education around at-home oral care?",
        "Describe your experience with digital imaging or charting systems.",
        "How do you stay current with infection-control and sterilization protocols?",
        "Tell me about a time you had to manage a full schedule with back-to-back patients.",
        "What does great teamwork with the front desk and dentist look like to you?",
      ],
      scorecard: ["Clinical technique & thoroughness", "Patient communication & comfort", "Infection control / sterilization knowledge", "Teamwork with dentist & front office", "Time management under a full schedule"],
    },
  },
  dispatcher: {
    key: "dispatcher",
    title: "Dispatcher",
    jobTitle: "Dispatcher",
    skeletonDescription:
      "We're hiring a Dispatcher to coordinate drivers, technicians, or field crews in real time — assigning jobs, tracking routes, and resolving schedule conflicts as they come up. You'll be the central point of contact between the field and the office, keeping customers informed and operations running smoothly under time pressure.",
    screeningQuestions: [
      "Describe your experience coordinating multiple field staff or drivers at once.",
      "What dispatch, routing, or scheduling software have you used?",
      "Are you comfortable working the shift hours this role requires (e.g., early morning, evenings, or weekends)?",
      "How do you typically handle an urgent schedule change with little notice?",
    ],
    interviewKit: {
      questions: [
        "Walk me through how you'd handle two urgent jobs coming in at the same time with limited crew available.",
        "Tell me about a time a driver or technician was running late — how did you communicate that to the customer?",
        "How do you prioritize when everything feels urgent?",
        "Describe your experience with dispatch or routing software.",
        "How do you stay calm when the phone won't stop ringing?",
        "Tell me about a mistake in scheduling you caught before it became a problem.",
        "How do you keep field staff and customers both informed during a disruption (e.g., weather, a breakdown)?",
        "What does a smooth, well-run shift look like to you?",
      ],
      scorecard: ["Composure under pressure", "Prioritization & multitasking", "Communication with field staff & customers", "Problem-solving during disruptions", "Familiarity with dispatch/routing tools"],
    },
  },
  "hvac-service-tech": {
    key: "hvac-service-tech",
    title: "HVAC Service Technician",
    jobTitle: "HVAC Service Technician",
    skeletonDescription:
      "We're looking for an HVAC Service Technician to install, maintain, and repair heating, ventilation, and air conditioning systems for residential or commercial customers. You'll diagnose issues, perform routine maintenance, and provide clear, professional service directly with customers in their homes or businesses. Relevant certification and hands-on troubleshooting experience are required.",
    screeningQuestions: [
      "Do you hold an EPA 608 certification (or the equivalent HVAC license for this state)?",
      "How many years of hands-on HVAC installation or repair experience do you have?",
      "Do you have a valid driver's license and a driving record clean enough to operate a company vehicle?",
      "Are you comfortable working in attics, crawlspaces, or rooftop units as needed?",
      "What brands or systems have you worked on most (e.g., residential split systems, commercial rooftop units)?",
    ],
    interviewKit: {
      questions: [
        "Walk me through how you'd diagnose a system that's blowing warm air instead of cold.",
        "Tell me about a repair job that turned out more complicated than expected — how did you handle it?",
        "How do you explain a repair or its cost to a customer who isn't familiar with HVAC systems?",
        "Describe your experience with refrigerant handling and EPA compliance.",
        "Tell me about a time you had to prioritize safety over speed on a job.",
        "How do you keep your service vehicle and tools organized for a full day of calls?",
        "What's your approach with a customer who's frustrated about a repeat issue?",
        "Walk me through your preventive-maintenance checklist for a typical system.",
      ],
      scorecard: ["Technical diagnosis & troubleshooting", "Safety & code compliance", "Customer communication", "Efficiency across a full call schedule", "Tool & vehicle organization"],
    },
  },
  "restaurant-server": {
    key: "restaurant-server",
    title: "Restaurant Server",
    jobTitle: "Restaurant Server",
    skeletonDescription:
      "Our restaurant is hiring a Server to deliver friendly, attentive, and efficient service to guests — taking orders, making menu recommendations, and keeping tables running smoothly during busy shifts. You'll work closely with the kitchen and other front-of-house staff to create a great dining experience from greeting to check.",
    screeningQuestions: [
      "How many years of serving or front-of-house restaurant experience do you have?",
      "Are you available to work evenings, weekends, and holiday shifts as needed?",
      "Do you currently hold (or can you obtain) any food handler or alcohol service certification required in this area?",
      "Describe your experience handling a full section of tables during a busy rush.",
    ],
    interviewKit: {
      questions: [
        "Walk me through how you'd handle a table that's unhappy with their food.",
        "Tell me about a time you had a full section during a rush — how did you keep everything running?",
        "How do you recommend menu items without being pushy?",
        "Describe how you communicate with the kitchen when there's a special request or allergy.",
        "Tell me about a time you had to deal with a difficult or rude guest.",
        "How do you stay positive and energetic through a long, busy shift?",
        "What does great teamwork with other servers and bussers look like to you?",
        "How do you handle it when an order comes out wrong?",
      ],
      scorecard: ["Guest service & friendliness", "Composure during a rush", "Teamwork with kitchen & front-of-house staff", "Problem-solving with difficult situations", "Menu knowledge"],
    },
  },
};

export const PLAYBOOK_KEYS: readonly string[] = Object.keys(JOB_PLAYBOOKS);

export function getPlaybook(key: string): JobPlaybook | null {
  return JOB_PLAYBOOKS[key] || null;
}

/** One line per supported role — "key (Title)" — for the tool description so
 *  the model can see every valid playbook_key without this file being
 *  duplicated into assistant-tools.ts by hand. */
export function playbookKeyList(): string {
  return PLAYBOOK_KEYS.map((k) => `${k} (${JOB_PLAYBOOKS[k].title})`).join(", ");
}

/** Protected-class content a screening or interview question must never
 *  contain. Conservative by design (a few false positives are cheap; a
 *  missed illegal question is not) — see the file header. */
export const PLAYBOOK_BANNED_PHRASES: RegExp[] = [
  // Age
  /how old are you/i,
  /\byour age\b/i,
  /\byears old\b/i,
  /date of birth/i,
  /when were you born/i,
  // Religion
  /\breligio/i,
  /\bchurch\b/i,
  /\byour faith\b/i,
  // Marital / family status, pregnancy
  /marital status/i,
  /\bmarried\b/i,
  /\bare you single\b/i,
  /\bchildren\b/i,
  /\byour kids\b/i,
  /child\s*care arrangements/i,
  /pregnan/i,
  // National origin
  /national origin/i,
  /where (are|were) you (from|born)/i,
  /\bcitizenship\b/i,
  /native (speaker|language)/i,
  /your accent/i,
  // Disability
  /disabilit/i,
  /medical condition/i,
  /\bhandicap/i,
  /health condition/i,
];

export function playbookQuestionViolatesPolicy(question: string): boolean {
  return PLAYBOOK_BANNED_PHRASES.some((re) => re.test(question));
}
