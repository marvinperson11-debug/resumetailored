import type { LibraryKind } from "./employee-hub";

/**
 * Built-in Training Library seed — the single source of truth for the 18
 * curated, US-government public-domain items. Lives in app code (not in the SQL
 * migration) so the content never passes through a SQL editor or statement
 * splitter: it is inserted idempotently by the admin route
 * GET /api/employer/seed-library?do=1 (upsert on source_url).
 *
 * Videos are EMBEDDED from the agency's own official YouTube channel (each
 * channel verified via YouTube oEmbed). Docs are authored public-domain
 * summaries with an attribution link to the official source page.
 */
export interface LibrarySeedItem {
  category: string;
  title: string;
  kind: LibraryKind;
  provider: string;
  embedUrl?: string;
  bodyHtml?: string;
  sourceUrl: string;
}

export const LIBRARY_SEED: LibrarySeedItem[] = [
  // ── Videos (verified on each agency's official channel) ──────────────────
  {
    category: "Safety — General",
    title: "Protecting My Workers Against Noise Hazards",
    kind: "video",
    provider: "NIOSH",
    embedUrl: "https://www.youtube-nocookie.com/embed/U4us4Ut2J7I",
    sourceUrl: "https://www.youtube.com/watch?v=U4us4Ut2J7I",
  },
  {
    category: "Safety — General",
    title: "NIOSH Health Hazard Evaluation: Measuring Air Contaminants at a Workplace",
    kind: "video",
    provider: "NIOSH",
    embedUrl: "https://www.youtube-nocookie.com/embed/DFi9lZ_WfPg",
    sourceUrl: "https://www.youtube.com/watch?v=DFi9lZ_WfPg",
  },
  {
    category: "Emergency Preparedness",
    title: "FEMA & Ready Campaign: Preparing Older Adults",
    kind: "video",
    provider: "FEMA",
    embedUrl: "https://www.youtube-nocookie.com/embed/qZ2PJG97fdk",
    sourceUrl: "https://www.youtube.com/watch?v=qZ2PJG97fdk",
  },
  {
    category: "Emergency Preparedness",
    title: "Active Shooter Preparedness: Options for Consideration",
    kind: "video",
    provider: "CISA",
    embedUrl: "https://www.youtube-nocookie.com/embed/i3QBktsRKVY",
    sourceUrl: "https://www.youtube.com/watch?v=i3QBktsRKVY",
  },
  {
    category: "Food Safety",
    title: "How FDA Investigates Foodborne Illness Outbreaks",
    kind: "video",
    provider: "FDA",
    embedUrl: "https://www.youtube-nocookie.com/embed/EeJwvAdJ-JU",
    sourceUrl: "https://www.youtube.com/watch?v=EeJwvAdJ-JU",
  },
  {
    category: "Food Safety",
    title: "A Flash of Food Safety: Why to Wash Your Hands",
    kind: "video",
    provider: "USDA",
    embedUrl: "https://www.youtube-nocookie.com/embed/7zWHkZI-7lg",
    sourceUrl: "https://www.youtube.com/watch?v=7zWHkZI-7lg",
  },
  {
    category: "Food Safety",
    title: "CDC in Action: Foodborne Outbreaks",
    kind: "video",
    provider: "CDC",
    embedUrl: "https://www.youtube-nocookie.com/embed/iIaKWNZhz74",
    sourceUrl: "https://www.youtube.com/watch?v=iIaKWNZhz74",
  },

  // ── Docs (authored public-domain summaries + official attribution) ────────
  {
    category: "Safety — General",
    title: "Fall Protection Basics",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: `<h2>Fall Protection Basics</h2><p>Falls are a leading cause of serious work-related injuries and deaths. Employers must set up the workplace to prevent falls — from overhead platforms, elevated work stations, or into holes in the floor and walls.</p><ul><li>Guard every floor hole a worker can walk into (with a railing and toe-board or a floor-hole cover).</li><li>Provide a guardrail and toe-board around every elevated open-sided platform, floor, or runway.</li><li>Use guardrails, safety-harness/lanyard systems, or safety nets where the risk of falling exists.</li><li>Keep floors clean, dry, and free of tripping hazards; provide the right protective equipment at no cost.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>`,
    sourceUrl: "https://www.osha.gov/fall-protection",
  },
  {
    category: "Safety — General",
    title: "Personal Protective Equipment (PPE)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: `<h2>Personal Protective Equipment (PPE)</h2><p>PPE is equipment worn to minimize exposure to hazards that cause workplace injuries and illnesses — from contact with chemical, radiological, physical, electrical, mechanical, or other hazards.</p><ul><li>Assess the workplace to determine what hazards are present and what PPE is required.</li><li>Provide PPE (gloves, eye/face protection, hard hats, hearing protection, respirators, high-visibility clothing) and train workers on how to use it.</li><li>Ensure PPE fits properly and is kept clean and in working condition.</li><li>Replace worn or damaged PPE immediately.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>`,
    sourceUrl: "https://www.osha.gov/personal-protective-equipment",
  },
  {
    category: "Safety — General",
    title: "Hazard Communication & Chemical Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: `<h2>Hazard Communication (HazCom)</h2><p>Workers have the right to know and understand the hazardous chemicals they use. The OSHA Hazard Communication Standard aligns with the Globally Harmonized System (GHS).</p><ul><li>Keep a written hazard-communication program and a list of hazardous chemicals on site.</li><li>Ensure every container is labeled with the product identifier and hazard warnings.</li><li>Maintain a Safety Data Sheet (SDS) for each hazardous chemical and make them accessible to all workers.</li><li>Train workers on the hazards, safe handling, and what to do in a spill or exposure.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>`,
    sourceUrl: "https://www.osha.gov/hazard-communication",
  },
  {
    category: "Safety — General",
    title: "Forklift & Powered Industrial Truck Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: `<h2>Forklift &amp; Powered Industrial Truck Safety</h2><p>Only trained and evaluated operators may drive a forklift. Employers must certify each operator and re-evaluate them at least every three years.</p><ul><li>Complete formal instruction, hands-on training, and a workplace evaluation before operating.</li><li>Inspect the truck before each shift; take an unsafe truck out of service.</li><li>Obey speed limits, keep loads low and tilted back, and never carry passengers.</li><li>Watch for pedestrians, sound the horn at intersections, and never exceed the rated load capacity.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>`,
    sourceUrl: "https://www.osha.gov/powered-industrial-trucks",
  },
  {
    category: "Safety — General",
    title: "Preventing Heat Illness at Work",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: `<h2>Preventing Heat Illness</h2><p>Workers exposed to hot indoor or outdoor environments can suffer heat illness, which can be fatal. Prevention comes down to <strong>water, rest, and shade</strong>.</p><ul><li>Drink water every 15 minutes, even if not thirsty.</li><li>Rest in the shade to cool down; new and returning workers need to acclimatize gradually.</li><li>Watch for symptoms — dizziness, confusion, heavy sweating or no sweating, nausea.</li><li>Know what to do in an emergency and call 911 for signs of heat stroke.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>`,
    sourceUrl: "https://www.osha.gov/heat",
  },
  {
    category: "Safety — General",
    title: "Bloodborne Pathogens",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: `<h2>Bloodborne Pathogens</h2><p>Workers who may contact blood or other potentially infectious materials are at risk of exposure to bloodborne pathogens such as HBV, HCV, and HIV.</p><ul><li>Follow the written Exposure Control Plan from the employer and use universal precautions.</li><li>Use PPE (gloves, gowns, eye protection) and engineering controls such as sharps containers.</li><li>Handle and dispose of sharps and contaminated materials safely.</li><li>Report exposures immediately; the Hepatitis B vaccine is offered at no cost to at-risk workers.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>`,
    sourceUrl: "https://www.osha.gov/bloodborne-pathogens",
  },
  {
    category: "Emergency Preparedness",
    title: "Emergency Action Plans",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: `<h2>Emergency Action Plans (EAP)</h2><p>An emergency action plan covers the actions employers and workers must take to ensure safety during a fire or other emergency.</p><ul><li>Define reporting procedures, evacuation routes, and exits.</li><li>Establish procedures for workers who stay to operate critical operations before they evacuate.</li><li>Account for all employees after evacuation, and identify rescue/medical duties.</li><li>Name people workers can contact for more information, and train on the plan.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>`,
    sourceUrl: "https://www.osha.gov/emergency-preparedness",
  },
  {
    category: "Emergency Preparedness",
    title: "Prepare Your Business for Emergencies",
    kind: "doc",
    provider: "FEMA",
    bodyHtml: `<h2>Prepare Your Business for Emergencies</h2><p>Every business should have a plan to protect employees, secure operations, and recover after an emergency.</p><ul><li>Assess the risks most likely to affect your location and operations.</li><li>Write an emergency plan and a business continuity plan; practice them.</li><li>Build an emergency kit and set up multiple ways to communicate with staff.</li><li>Back up records off-site and review coverage with your insurer.</li></ul><p>Source: Ready.gov, U.S. Federal Emergency Management Agency (public domain).</p>`,
    sourceUrl: "https://www.ready.gov/business",
  },
  {
    category: "Workplace Conduct",
    title: "Preventing Workplace Violence",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: `<h2>Preventing Workplace Violence</h2><p>Workplace violence is any act or threat of physical violence, harassment, intimidation, or other threatening disruptive behavior at the work site.</p><ul><li>Adopt a zero-tolerance policy toward workplace violence.</li><li>Train staff to recognize warning signs and de-escalate conflict.</li><li>Provide safety measures — good lighting, alarms, and clear reporting channels.</li><li>Encourage prompt reporting; investigate every incident and threat.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>`,
    sourceUrl: "https://www.osha.gov/workplace-violence",
  },
  {
    category: "Workplace Conduct",
    title: "Worker Safety & Health Rights",
    kind: "doc",
    provider: "DOL",
    bodyHtml: `<h2>Worker Safety &amp; Health Rights</h2><p>Workers are entitled to a safe and healthful workplace under the Occupational Safety and Health Act.</p><ul><li>You have the right to working conditions that do not pose a risk of serious harm.</li><li>You can receive information and training about hazards and prevention.</li><li>You can review records of work-related injuries and illnesses.</li><li>You can raise a safety concern or file an OSHA complaint without retaliation.</li></ul><p>Source: U.S. Department of Labor / OSHA (public domain).</p>`,
    sourceUrl: "https://www.dol.gov/general/topic/safety-health",
  },
  {
    category: "Food Safety",
    title: "Food Safety Basics: Clean, Separate, Cook, Chill",
    kind: "doc",
    provider: "FDA",
    bodyHtml: `<h2>Food Safety Basics</h2><p>Four simple steps prevent most foodborne illness: <strong>Clean, Separate, Cook, and Chill.</strong></p><ul><li><strong>Clean:</strong> wash hands for 20 seconds and sanitize surfaces and utensils often.</li><li><strong>Separate:</strong> keep raw meat, poultry, seafood, and eggs away from ready-to-eat foods.</li><li><strong>Cook:</strong> use a food thermometer to reach safe internal temperatures.</li><li><strong>Chill:</strong> refrigerate promptly at 40&deg;F or below; never thaw food on the counter.</li></ul><p>Source: FoodSafety.gov (HHS / USDA / FDA, public domain).</p>`,
    sourceUrl: "https://www.foodsafety.gov/keep-food-safe/4-steps-to-food-safety",
  },
];
