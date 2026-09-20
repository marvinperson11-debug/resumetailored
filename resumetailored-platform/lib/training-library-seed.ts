import type { LibraryKind } from "./employee-hub";

/**
 * Built-in Training Library seed — the single source of truth for the curated,
 * US-government public-domain items. Lives in app code (not in the SQL migration)
 * so the content never passes through a SQL editor or statement splitter: it is
 * inserted/refreshed idempotently by the admin route
 * GET /api/employer/seed-library?do=1 (upsert on source_url).
 *
 * Organized by INDUSTRY VERTICAL (the category filters): Manufacturing,
 * Healthcare, Construction, Warehouse & Logistics, Hospitality & Food Service,
 * Cleaning & Janitorial, Office & Ergonomics, Workplace Conduct, Emergency
 * Preparedness.
 *
 * SOURCES: official US-government channels only (OSHA and OSHA industry pages,
 * NIOSH/CDC, Cal/OSHA, FEMA/Ready.gov, CISA, FDA, USDA, DOL, EEOC, EPA, SAMHSA).
 * Every video is EMBEDDED (never downloaded) from the agency's own official
 * YouTube channel and was verified via the YouTube oEmbed API (author_name =
 * the agency); re-uploads on third-party channels were rejected. Docs are
 * authored public-domain summaries with an attribution link to the official
 * source page. Each item has a UNIQUE source_url (the upsert key); a few pages
 * shared across verticals are disambiguated with a #anchor that still opens the
 * same official page.
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

/** Compact authored-summary helper — keeps every doc body consistent and free of
 *  fragile punctuation. */
function doc(intro: string, points: string[], source: string): string {
  return `<p>${intro}</p><ul>${points.map((p) => `<li>${p}</li>`).join("")}</ul><p>Source: ${source} (public domain).</p>`;
}

export const LIBRARY_SEED: LibrarySeedItem[] = [
  // ══════════════ VIDEOS (verified on each agency's official channel) ══════════
  {
    category: "Manufacturing",
    title: "Protecting My Workers Against Noise Hazards",
    kind: "video",
    provider: "NIOSH",
    embedUrl: "https://www.youtube-nocookie.com/embed/U4us4Ut2J7I",
    sourceUrl: "https://www.youtube.com/watch?v=U4us4Ut2J7I",
  },
  {
    category: "Manufacturing",
    title: "NIOSH Health Hazard Evaluation: Measuring Air Contaminants at a Workplace",
    kind: "video",
    provider: "NIOSH",
    embedUrl: "https://www.youtube-nocookie.com/embed/DFi9lZ_WfPg",
    sourceUrl: "https://www.youtube.com/watch?v=DFi9lZ_WfPg",
  },
  {
    category: "Cleaning & Janitorial",
    title: "NIOSH Health Hazard Evaluation: Measuring Contaminants on Skin and Surfaces",
    kind: "video",
    provider: "NIOSH",
    embedUrl: "https://www.youtube-nocookie.com/embed/SZ4FYsMzmdo",
    sourceUrl: "https://www.youtube.com/watch?v=SZ4FYsMzmdo",
  },
  {
    category: "Healthcare",
    title: "Cal/OSHA Training: Use of N95 Respirators",
    kind: "video",
    provider: "Cal/OSHA",
    embedUrl: "https://www.youtube-nocookie.com/embed/GmJxzGXeIvo",
    sourceUrl: "https://www.youtube.com/watch?v=GmJxzGXeIvo",
  },
  {
    category: "Office & Ergonomics",
    title: "Workplace Health Disparities: A Total Worker Health Perspective",
    kind: "video",
    provider: "NIOSH",
    embedUrl: "https://www.youtube-nocookie.com/embed/rO4k3nrkGvA",
    sourceUrl: "https://www.youtube.com/watch?v=rO4k3nrkGvA",
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
    category: "Hospitality & Food Service",
    title: "How FDA Investigates Foodborne Illness Outbreaks",
    kind: "video",
    provider: "FDA",
    embedUrl: "https://www.youtube-nocookie.com/embed/EeJwvAdJ-JU",
    sourceUrl: "https://www.youtube.com/watch?v=EeJwvAdJ-JU",
  },
  {
    category: "Hospitality & Food Service",
    title: "A Flash of Food Safety: Why to Wash Your Hands",
    kind: "video",
    provider: "USDA",
    embedUrl: "https://www.youtube-nocookie.com/embed/7zWHkZI-7lg",
    sourceUrl: "https://www.youtube.com/watch?v=7zWHkZI-7lg",
  },
  {
    category: "Hospitality & Food Service",
    title: "CDC in Action: Foodborne Outbreaks",
    kind: "video",
    provider: "CDC",
    embedUrl: "https://www.youtube-nocookie.com/embed/iIaKWNZhz74",
    sourceUrl: "https://www.youtube.com/watch?v=iIaKWNZhz74",
  },

  // ════════════════════════════ MANUFACTURING ═════════════════════════════════
  {
    category: "Manufacturing",
    title: "Forklift & Powered Industrial Truck Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Only trained and evaluated operators may drive a forklift; employers must certify each operator and re-evaluate at least every three years.",
      [
        "Complete formal instruction, hands-on training, and a workplace evaluation before operating.",
        "Inspect the truck before each shift and take an unsafe truck out of service.",
        "Keep loads low and tilted back, obey speed limits, and never carry passengers.",
        "Watch for pedestrians, sound the horn at intersections, and never exceed the rated capacity.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/powered-industrial-trucks",
  },
  {
    category: "Manufacturing",
    title: "Lockout/Tagout: Control of Hazardous Energy",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Lockout/tagout protects workers from the unexpected start-up of machines or release of stored energy during service and maintenance.",
      [
        "Follow written energy-control procedures for each machine.",
        "Isolate every energy source (electrical, hydraulic, pneumatic, thermal, gravity) and apply your own lock and tag.",
        "Verify zero energy before starting work; only the person who applied a lock removes it.",
        "Train authorized, affected, and other employees on the program.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/control-hazardous-energy",
  },
  {
    category: "Manufacturing",
    title: "Machine Guarding",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Machine guarding protects workers from hazards such as rotating parts, nip points, flying chips, and sparks.",
      [
        "Guard every point of operation, ingoing nip point, rotating part, and flying-debris hazard.",
        "Never remove or bypass a guard while a machine can operate.",
        "Report missing or damaged guards immediately and lock the machine out until repaired.",
        "Keep hands and clothing clear of moving parts; use push sticks and tools where provided.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/machine-guarding",
  },
  {
    category: "Manufacturing",
    title: "Welding, Cutting & Brazing (Hot Work)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Hot work creates fire, burn, fume, and radiation hazards that require permits and controls.",
      [
        "Use a hot-work permit and clear or protect combustibles within 35 feet.",
        "Keep a fire watch during and after the work; have an extinguisher on hand.",
        "Ventilate the area or use local exhaust to control fumes; wear a shaded face shield and flame-resistant PPE.",
        "Inspect cables, hoses, and cylinders; secure cylinders upright.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/welding-cutting-brazing",
  },
  {
    category: "Manufacturing",
    title: "Preventing Amputations",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Amputations are among the most severe workplace injuries and are usually caused by unguarded or improperly guarded machinery.",
      [
        "Guard the point of operation and power-transmission parts.",
        "Use lockout/tagout during setup, clearing jams, cleaning, and maintenance.",
        "Never reach into a machine that is running.",
        "Train workers on machine-specific hazards and safe work procedures.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/amputations",
  },
  {
    category: "Manufacturing",
    title: "Hazard Communication & Chemical Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Workers have the right to know and understand the hazardous chemicals they use; the OSHA Hazard Communication Standard aligns with the Globally Harmonized System (GHS).",
      [
        "Keep a written program and a list of hazardous chemicals on site.",
        "Label every container with the product identifier and hazard warnings.",
        "Maintain a Safety Data Sheet (SDS) for each chemical and make them accessible.",
        "Train workers on hazards, safe handling, and what to do in a spill or exposure.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/hazard-communication",
  },
  {
    category: "Manufacturing",
    title: "Hearing Conservation & Noise",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Loud noise causes permanent, preventable hearing loss; employers must act when noise reaches an 8-hour average of 85 decibels.",
      [
        "Monitor noise levels and enroll exposed workers in a hearing-conservation program.",
        "Reduce noise at the source with engineering and administrative controls first.",
        "Provide and fit hearing protection; require it in posted high-noise areas.",
        "Offer annual audiograms and training on protecting hearing.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/noise",
  },
  {
    category: "Manufacturing",
    title: "Personal Protective Equipment (PPE)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "PPE minimizes exposure to hazards that cause workplace injuries and illnesses when engineering and work-practice controls are not enough.",
      [
        "Assess the workplace to determine what hazards are present and what PPE is required.",
        "Provide PPE and train workers on how to use, adjust, and care for it.",
        "Ensure PPE fits properly and is kept clean and in working condition.",
        "Replace worn or damaged PPE immediately.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/personal-protective-equipment",
  },
  {
    category: "Manufacturing",
    title: "Confined Spaces",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Permit-required confined spaces (tanks, vessels, pits, silos) can hold life-threatening atmospheres and engulfment hazards.",
      [
        "Identify and label permit-required confined spaces.",
        "Test the atmosphere before and during entry; ventilate as needed.",
        "Use a trained attendant, entry supervisor, and rescue plan for every entry.",
        "Never enter to attempt a rescue without proper training and equipment.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/confined-spaces",
  },
  {
    category: "Manufacturing",
    title: "Electrical Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Electricity causes shocks, burns, arc-flash injuries, and fires; only qualified workers should service energized equipment.",
      [
        "De-energize and lock out circuits before working on them.",
        "Inspect cords and tools; remove damaged equipment from service.",
        "Use ground-fault protection and keep panels accessible and closed.",
        "Maintain safe approach distances from overhead and exposed conductors.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/electrical",
  },
  {
    category: "Manufacturing",
    title: "Hand & Power Tool Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Hand and power tools cause many preventable cuts, strikes, and repetitive-strain injuries.",
      [
        "Use the right tool for the job and inspect it before use.",
        "Keep guards in place and never carry a tool by the cord or hose.",
        "Disconnect power before changing blades or bits.",
        "Wear appropriate eye and hand protection.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/hand-power-tools",
  },
  {
    category: "Manufacturing",
    title: "Combustible Dust",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Fine dust from wood, metal, grain, plastics, and other materials can fuel powerful explosions.",
      [
        "Control dust accumulation with housekeeping and dust collection.",
        "Eliminate ignition sources near dust-generating processes.",
        "Use proper electrical equipment and bonding/grounding.",
        "Inspect ducts and equipment for dust build-up.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/combustible-dust",
  },
  {
    category: "Manufacturing",
    title: "Ergonomics & Repetitive Motion (Production Work)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Repetitive motion, awkward postures, and forceful exertions cause musculoskeletal disorders on production lines.",
      [
        "Adjust workstations so work is at a comfortable height and reach.",
        "Rotate tasks and take micro-breaks to reduce repetition.",
        "Use lift assists and carts instead of manual lifting where possible.",
        "Report early aches so jobs can be adjusted before an injury develops.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/ergonomics#manufacturing",
  },

  // ══════════════════════════════ HEALTHCARE ══════════════════════════════════
  {
    category: "Healthcare",
    title: "Bloodborne Pathogens",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Workers who may contact blood or other potentially infectious materials are at risk of exposure to bloodborne pathogens such as HBV, HCV, and HIV.",
      [
        "Follow the written Exposure Control Plan from the employer and use universal precautions.",
        "Use PPE (gloves, gowns, eye protection) and engineering controls such as sharps containers.",
        "Handle and dispose of sharps and contaminated materials safely.",
        "Report exposures immediately; the Hepatitis B vaccine is offered at no cost to at-risk workers.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/bloodborne-pathogens",
  },
  {
    category: "Healthcare",
    title: "Workplace Violence Prevention in Healthcare",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Healthcare and social-service workers face some of the highest rates of workplace violence of any industry.",
      [
        "Adopt a written workplace-violence prevention program with management commitment.",
        "Train staff to recognize warning signs and de-escalate.",
        "Provide alarms, safe rooms, and clear reporting channels.",
        "Record and investigate every incident, including verbal threats.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/healthcare/workplace-violence",
  },
  {
    category: "Healthcare",
    title: "Safe Patient Handling",
    kind: "doc",
    provider: "NIOSH",
    bodyHtml: doc(
      "Manually lifting and repositioning patients is a leading cause of back and shoulder injuries for caregivers.",
      [
        "Use mechanical lifts, slide sheets, and other assistive devices instead of manual lifting.",
        "Assess each patient and plan the move before starting.",
        "Use team lifts and communicate every move.",
        "Follow the facility safe-patient-handling program and report near-misses.",
      ],
      "National Institute for Occupational Safety and Health"
    ),
    sourceUrl: "https://www.cdc.gov/niosh/topics/safepatient/",
  },
  {
    category: "Healthcare",
    title: "Infection Control & Standard Precautions",
    kind: "doc",
    provider: "CDC",
    bodyHtml: doc(
      "Standard precautions treat all blood and body fluids as potentially infectious and are the foundation of infection control.",
      [
        "Perform hand hygiene before and after every patient contact.",
        "Use gloves, gowns, masks, and eye protection based on the expected exposure.",
        "Follow respiratory hygiene, safe injection practices, and proper cleaning.",
        "Handle and dispose of sharps and contaminated items safely.",
      ],
      "Centers for Disease Control and Prevention"
    ),
    sourceUrl: "https://www.cdc.gov/infection-control/",
  },
  {
    category: "Healthcare",
    title: "Hazardous Drugs in Healthcare",
    kind: "doc",
    provider: "NIOSH",
    bodyHtml: doc(
      "Preparing and administering antineoplastic and other hazardous drugs can expose workers through skin contact and inhalation.",
      [
        "Follow the facility list of hazardous drugs and handling procedures.",
        "Use closed-system transfer devices and ventilated cabinets.",
        "Wear chemotherapy-rated gloves and gowns; double-glove when required.",
        "Clean spills with a designated kit and dispose of waste as hazardous.",
      ],
      "National Institute for Occupational Safety and Health"
    ),
    sourceUrl: "https://www.cdc.gov/niosh/topics/hazdrug/",
  },
  {
    category: "Healthcare",
    title: "Sharps & Needlestick Injury Prevention",
    kind: "doc",
    provider: "NIOSH",
    bodyHtml: doc(
      "Needlesticks and other sharps injuries can transmit bloodborne infections and are highly preventable.",
      [
        "Use devices with sharps-injury protection and never recap needles by hand.",
        "Activate safety features and dispose of sharps in approved containers.",
        "Keep sharps containers within easy reach and replace before they overfill.",
        "Report every injury promptly for follow-up care.",
      ],
      "National Institute for Occupational Safety and Health"
    ),
    sourceUrl: "https://www.cdc.gov/niosh/topics/bbp/",
  },
  {
    category: "Healthcare",
    title: "Respiratory Protection (N95 & Fit)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Respirators protect workers from airborne infectious agents, dusts, and chemicals only when selected, fit-tested, and worn correctly.",
      [
        "Enroll respirator users in a written respiratory-protection program.",
        "Fit-test tight-fitting respirators before first use and at least annually.",
        "Perform a user seal check every time you put a respirator on.",
        "Store, inspect, and replace respirators per the manufacturer instructions.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/respiratory-protection",
  },
  {
    category: "Healthcare",
    title: "Slips, Trips & Falls in Hospitals",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Wet floors, cords, and clutter cause falls that injure both staff and patients.",
      [
        "Clean spills immediately and use wet-floor signs.",
        "Keep corridors, cords, and equipment out of walking paths.",
        "Wear slip-resistant footwear.",
        "Ensure good lighting in stairwells and patient rooms.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/healthcare#slips",
  },

  // ═════════════════════════════ CONSTRUCTION ═════════════════════════════════
  {
    category: "Construction",
    title: "Fall Protection",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Falls are the leading cause of death in construction; protection is required at six feet in construction and four feet in general industry.",
      [
        "Use guardrails, safety nets, or personal fall-arrest systems at height.",
        "Inspect harnesses and lanyards before each use and anchor to a rated point.",
        "Cover and mark floor and roof openings.",
        "Provide a rescue plan for anyone working in a harness.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/fall-protection",
  },
  {
    category: "Construction",
    title: "Ladders & Stairways",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Improper ladder use causes many serious falls that are entirely preventable.",
      [
        "Choose the right ladder for the job and inspect it before use.",
        "Maintain three points of contact and face the ladder.",
        "Set extension ladders at a 4-to-1 angle and extend three feet above the landing.",
        "Never stand on the top rungs or overreach.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/stairways-ladders",
  },
  {
    category: "Construction",
    title: "Scaffolding Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Scaffolds must be built and inspected by competent persons to prevent collapses and falls.",
      [
        "Have a competent person inspect the scaffold before each shift.",
        "Fully plank platforms and provide guardrails or fall arrest.",
        "Ensure firm footing and proper base plates or mud sills.",
        "Keep scaffolds clear of power lines and do not overload them.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/scaffolding",
  },
  {
    category: "Construction",
    title: "Trenching & Excavation",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Trench cave-ins can bury a worker in seconds; protective systems are required in trenches five feet deep or more.",
      [
        "Slope, shore, or shield trenches based on soil and depth.",
        "Keep spoil piles at least two feet from the edge.",
        "Provide a safe way in and out within 25 feet of workers.",
        "Have a competent person inspect the trench daily and after rain.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/trenching-excavation",
  },
  {
    category: "Construction",
    title: "Respirable Crystalline Silica",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Cutting, grinding, or drilling concrete and stone releases fine silica dust that causes silicosis and lung cancer.",
      [
        "Use water or vacuum dust controls on tools (Table 1 methods).",
        "Provide respiratory protection where controls are not enough.",
        "Keep exposed workers in a medical-surveillance program.",
        "Do not dry-sweep silica dust; use HEPA vacuuming or wet methods.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/silica-crystalline",
  },
  {
    category: "Construction",
    title: "Struck-By Hazards",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Struck-by injuries from vehicles, falling objects, and flying debris are one of the construction Focus Four hazards.",
      [
        "Wear high-visibility clothing around equipment and traffic.",
        "Stay out of the swing radius and blind spots of machinery.",
        "Secure tools and materials at height and use toe boards.",
        "Use spotters and traffic-control plans on active sites.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/construction#struck-by",
  },
  {
    category: "Construction",
    title: "Caught-In or -Between Hazards",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Workers can be caught in or crushed by machinery, collapsing materials, or between equipment and fixed objects.",
      [
        "Use lockout/tagout on equipment during service.",
        "Never work under suspended loads.",
        "Protect against trench and wall collapse.",
        "Keep clear of pinch points on rotating and moving equipment.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/construction#caught-in",
  },
  {
    category: "Construction",
    title: "Preventing Heat Illness (Outdoor Work)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Workers in hot environments can suffer heat illness, which can be fatal; prevention comes down to water, rest, and shade.",
      [
        "Drink water often, even when not thirsty.",
        "Take rest breaks in the shade and acclimatize new and returning workers gradually.",
        "Watch for dizziness, confusion, heavy or absent sweating, and nausea.",
        "Know the emergency plan and call 911 for signs of heat stroke.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/heat",
  },
  {
    category: "Construction",
    title: "Cranes & Rigging",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Crane operations require qualified operators, inspected rigging, and clear communication to avoid dropped loads and contacts.",
      [
        "Use qualified, certified operators and trained signal persons.",
        "Inspect slings, hooks, and rigging before each lift.",
        "Maintain clearance from power lines and barricade the swing area.",
        "Never exceed the load chart and never ride the load.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/cranes-derricks-construction",
  },

  // ═════════════════════════ WAREHOUSE & LOGISTICS ════════════════════════════
  {
    category: "Warehouse & Logistics",
    title: "Warehouse Safety Essentials",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Warehousing combines forklift traffic, manual handling, and stacked loads, so the basics matter every shift.",
      [
        "Keep aisles and exits clear and floors free of hazards.",
        "Follow forklift and pedestrian traffic rules.",
        "Store and stack loads safely and within rack limits.",
        "Use PPE and safe lifting techniques.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/warehousing",
  },
  {
    category: "Warehouse & Logistics",
    title: "Manual Material Handling & Safe Lifting",
    kind: "doc",
    provider: "NIOSH",
    bodyHtml: doc(
      "Manual lifting, carrying, and lowering are leading causes of back and shoulder injuries.",
      [
        "Plan the lift and use carts, dollies, or lift assists when possible.",
        "Keep loads close, lift with the legs, and avoid twisting.",
        "Get help or split loads that are too heavy or awkward.",
        "Store frequently handled items between knee and shoulder height.",
      ],
      "National Institute for Occupational Safety and Health"
    ),
    sourceUrl: "https://www.cdc.gov/niosh/topics/ergonomics/",
  },
  {
    category: "Warehouse & Logistics",
    title: "Loading Dock & Trailer Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Docks are high-risk zones where trucks, forklifts, and workers meet.",
      [
        "Chock wheels and use dock locks or restraints before loading.",
        "Use dock plates rated for the load and inspect them.",
        "Guard dock edges and keep them clear.",
        "Confirm the trailer is secure before a forklift enters it.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/warehousing#docks",
  },
  {
    category: "Warehouse & Logistics",
    title: "Storage, Racking & Stacking",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Overloaded or damaged racks and unstable stacks can collapse and crush workers.",
      [
        "Follow rack capacity limits and never exceed them.",
        "Inspect racks for damage and tag out damaged sections.",
        "Stack loads level, stable, and cross-tied where needed.",
        "Anchor tall racks and keep flue spaces clear.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/materials-handling",
  },
  {
    category: "Warehouse & Logistics",
    title: "Pedestrian & Forklift Traffic Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Most serious forklift incidents involve pedestrians; separating people from trucks saves lives.",
      [
        "Mark pedestrian walkways and keep to them.",
        "Make eye contact with operators and never walk behind a moving truck.",
        "Use mirrors, horns, and lights at blind corners.",
        "Slow down and yield at intersections.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/powered-industrial-trucks#pedestrians",
  },
  {
    category: "Warehouse & Logistics",
    title: "Slips, Trips & Falls (Same Level)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Same-level slips and trips are among the most common workplace injuries.",
      [
        "Clean spills right away and mark wet areas.",
        "Keep walkways clear of cords, pallets, and clutter.",
        "Fix uneven floors and provide good lighting.",
        "Wear slip-resistant footwear.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/walking-working-surfaces",
  },
  {
    category: "Warehouse & Logistics",
    title: "Cold Stress in Freezers & Cold Storage",
    kind: "doc",
    provider: "NIOSH",
    bodyHtml: doc(
      "Working in freezers and cold storage can cause hypothermia and frostbite.",
      [
        "Dress in insulated layers and keep spare dry clothing.",
        "Take warm-up breaks and limit time in the cold.",
        "Watch for shivering, numbness, and confusion.",
        "Keep floors clear of ice.",
      ],
      "National Institute for Occupational Safety and Health"
    ),
    sourceUrl: "https://www.cdc.gov/niosh/topics/coldstress/",
  },

  // ════════════════════════ HOSPITALITY & FOOD SERVICE ════════════════════════
  {
    category: "Hospitality & Food Service",
    title: "Food Safety Basics: Clean, Separate, Cook, Chill",
    kind: "doc",
    provider: "FDA",
    bodyHtml: doc(
      "Four simple steps prevent most foodborne illness: Clean, Separate, Cook, and Chill.",
      [
        "Clean: wash hands for 20 seconds and sanitize surfaces and utensils often.",
        "Separate: keep raw meat, poultry, seafood, and eggs away from ready-to-eat foods.",
        "Cook: use a food thermometer to reach safe internal temperatures.",
        "Chill: refrigerate promptly at 40 degrees F or below and never thaw on the counter.",
      ],
      "FoodSafety.gov (HHS / USDA / FDA)"
    ),
    sourceUrl: "https://www.foodsafety.gov/keep-food-safe/4-steps-to-food-safety",
  },
  {
    category: "Hospitality & Food Service",
    title: "Handwashing for Food Workers",
    kind: "doc",
    provider: "CDC",
    bodyHtml: doc(
      "Clean hands are one of the most effective ways to stop the spread of foodborne illness.",
      [
        "Wash with soap and warm water for at least 20 seconds.",
        "Wash after using the restroom, handling raw food, and touching the face or trash.",
        "Dry with a single-use towel.",
        "Do not handle ready-to-eat food with bare hands.",
      ],
      "Centers for Disease Control and Prevention"
    ),
    sourceUrl: "https://www.cdc.gov/handwashing/",
  },
  {
    category: "Hospitality & Food Service",
    title: "Food Allergen Awareness",
    kind: "doc",
    provider: "FDA",
    bodyHtml: doc(
      "The major food allergens can cause severe reactions, so accurate handling and communication are essential.",
      [
        "Know the major allergens and read every label.",
        "Prevent cross-contact with clean hands, utensils, and surfaces.",
        "Answer guest allergen questions accurately or find someone who can.",
        "Take allergy requests seriously every time.",
      ],
      "U.S. Food and Drug Administration"
    ),
    sourceUrl: "https://www.fda.gov/food/food-labeling-nutrition/food-allergies",
  },
  {
    category: "Hospitality & Food Service",
    title: "Kitchen Knife Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Cuts are among the most common kitchen injuries and are easy to prevent.",
      [
        "Keep knives sharp and use the right knife for the task.",
        "Cut on a stable board and keep fingers curled back.",
        "Carry a knife point-down at your side and never try to catch a falling knife.",
        "Wash and store knives separately, never in a sink of water.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/etools/youth/restaurant#knives",
  },
  {
    category: "Hospitality & Food Service",
    title: "Burns & Hot Surfaces",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Hot oil, steam, ovens, and dishwashers cause serious burns in food service.",
      [
        "Use dry mitts and warn coworkers when carrying hot items.",
        "Open lids away from your face and lower food gently into hot oil.",
        "Keep grill and fryer areas free of water.",
        "Let equipment cool before cleaning.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/etools/youth/restaurant#burns",
  },
  {
    category: "Hospitality & Food Service",
    title: "Wet Floors & Slip Prevention",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Grease and water make food-service floors slippery, causing frequent falls.",
      [
        "Clean spills immediately and use wet-floor signs.",
        "Wear slip-resistant shoes.",
        "Keep floors degreased and mats flat and in place.",
        "Walk, do not run, in the kitchen.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/etools/youth/restaurant#slips",
  },
  {
    category: "Hospitality & Food Service",
    title: "Norovirus Prevention for Food Workers",
    kind: "doc",
    provider: "CDC",
    bodyHtml: doc(
      "Norovirus spreads easily through food handled by sick workers and causes most foodborne-illness outbreaks.",
      [
        "Stay home while sick and for at least 48 hours after symptoms stop.",
        "Wash hands thoroughly, especially after using the restroom.",
        "Avoid bare-hand contact with ready-to-eat food.",
        "Clean and disinfect surfaces after any vomiting or diarrhea event.",
      ],
      "Centers for Disease Control and Prevention"
    ),
    sourceUrl: "https://www.cdc.gov/norovirus/",
  },

  // ═══════════════════════════ CLEANING & JANITORIAL ══════════════════════════
  {
    category: "Cleaning & Janitorial",
    title: "Cleaning Chemical Safety & Safety Data Sheets",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Cleaning products are chemicals; workers must know their hazards and how to use them safely.",
      [
        "Read the label and Safety Data Sheet before using a product.",
        "Keep products in labeled original containers; never in unmarked bottles.",
        "Follow dilution instructions and never use more than directed.",
        "Store chemicals away from food and incompatible products.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/hazard-communication#cleaning",
  },
  {
    category: "Cleaning & Janitorial",
    title: "Never Mix Cleaning Chemicals (Bleach + Ammonia)",
    kind: "doc",
    provider: "CDC",
    bodyHtml: doc(
      "Mixing cleaning products can create toxic gases that cause serious lung injury.",
      [
        "Never mix bleach with ammonia or with acids such as some toilet-bowl cleaners.",
        "Use one product at a time and rinse surfaces between products.",
        "Ensure good ventilation while cleaning.",
        "Leave the area and get fresh air if you smell a strong gas.",
      ],
      "Centers for Disease Control and Prevention / NIOSH"
    ),
    sourceUrl: "https://www.cdc.gov/niosh/topics/chemical-safety/",
  },
  {
    category: "Cleaning & Janitorial",
    title: "Gloves & PPE for Cleaning Staff",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "The right gloves and PPE protect cleaning workers from chemicals and contamination.",
      [
        "Choose glove material suited to the chemical being used.",
        "Inspect gloves for tears and replace them when damaged.",
        "Wear eye protection when spraying or mixing.",
        "Wash hands after removing gloves.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/personal-protective-equipment#cleaning",
  },
  {
    category: "Cleaning & Janitorial",
    title: "Bloodborne Pathogens for Custodial Work",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Cleaning staff may encounter blood or body fluids and must be protected under the bloodborne-pathogens standard.",
      [
        "Treat all blood and body fluids as infectious.",
        "Wear gloves and use a spill kit for clean-ups.",
        "Place contaminated waste and sharps in proper containers.",
        "Report exposures immediately.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/bloodborne-pathogens#custodial",
  },
  {
    category: "Cleaning & Janitorial",
    title: "Safe Use of Disinfectants",
    kind: "doc",
    provider: "EPA",
    bodyHtml: doc(
      "Disinfectants are registered pesticides and only work safely when used as directed.",
      [
        "Use an EPA-registered product and follow the contact time on the label.",
        "Do not mix disinfectants with other cleaners.",
        "Ventilate the area and wear the PPE listed on the label.",
        "Keep products out of reach of children and away from food areas.",
      ],
      "U.S. Environmental Protection Agency"
    ),
    sourceUrl: "https://www.epa.gov/pesticide-registration/selected-epa-registered-disinfectants",
  },
  {
    category: "Cleaning & Janitorial",
    title: "Preventing Slips on Wet Floors (Janitorial)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Mopping and floor care create slip hazards for cleaning staff and the public.",
      [
        "Post wet-floor signs and clean one section at a time.",
        "Wear slip-resistant footwear.",
        "Squeegee excess water and let floors dry.",
        "Keep cords and equipment out of walkways.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/walking-working-surfaces#janitorial",
  },
  {
    category: "Cleaning & Janitorial",
    title: "Ergonomics for Cleaning Work",
    kind: "doc",
    provider: "NIOSH",
    bodyHtml: doc(
      "Repetitive scrubbing, pushing carts, and awkward postures strain the back, shoulders, and wrists.",
      [
        "Use long-handled tools to avoid bending and reaching.",
        "Push rather than pull carts and keep loads light.",
        "Switch hands and tasks to reduce repetition.",
        "Report aches early so tasks can be adjusted.",
      ],
      "National Institute for Occupational Safety and Health"
    ),
    sourceUrl: "https://www.cdc.gov/niosh/topics/ergonomics/#cleaning",
  },
  {
    category: "Cleaning & Janitorial",
    title: "Waste & Sharps Disposal",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Improper handling of trash and hidden sharps causes cuts and exposures for cleaning staff.",
      [
        "Never press trash down with hands or feet; sharps may be inside.",
        "Use puncture-resistant containers for sharps.",
        "Wear cut-resistant gloves when handling waste.",
        "Report and safely contain any found sharps.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/bloodborne-pathogens#waste",
  },

  // ═══════════════════════════ OFFICE & ERGONOMICS ════════════════════════════
  {
    category: "Office & Ergonomics",
    title: "Computer Workstation Ergonomics",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "A well-set-up workstation reduces neck, back, and wrist strain from long hours at a screen.",
      [
        "Set the top of the monitor at or just below eye level, about an arm length away.",
        "Keep elbows near 90 degrees and wrists straight while typing.",
        "Support the lower back and keep feet flat on the floor or a footrest.",
        "Take short movement breaks and look away from the screen regularly.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/etools/computer-workstations",
  },
  {
    category: "Office & Ergonomics",
    title: "Office Ergonomics: Sitting & Movement",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Staying in one posture too long contributes to musculoskeletal discomfort.",
      [
        "Alternate between sitting and standing where possible.",
        "Adjust chair height, armrests, and lumbar support to fit you.",
        "Keep frequently used items within easy reach.",
        "Stand and stretch briefly at least once an hour.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/ergonomics",
  },
  {
    category: "Office & Ergonomics",
    title: "Preventing Eye Strain at Screens",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Long screen time can cause tired, dry, or blurred eyes.",
      [
        "Follow the 20-20-20 rule: every 20 minutes look 20 feet away for 20 seconds.",
        "Reduce glare with blinds and proper monitor placement.",
        "Adjust text size, brightness, and contrast for comfort.",
        "Blink often and keep the screen clean.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/etools/computer-workstations#monitors",
  },
  {
    category: "Office & Ergonomics",
    title: "Office Fire Safety & Evacuation",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Every office needs clear exits and a practiced plan for fires and other emergencies.",
      [
        "Know at least two exits and the assembly point.",
        "Keep exits, aisles, and electrical panels clear.",
        "Do not use elevators during a fire.",
        "Report blocked exits and non-working alarms.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/emergency-preparedness#office",
  },
  {
    category: "Office & Ergonomics",
    title: "Electrical Cords & Office Electrical Safety",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Overloaded outlets and damaged cords are common office fire and shock hazards.",
      [
        "Do not run cords under rugs or across walkways.",
        "Use surge protectors instead of daisy-chained power strips.",
        "Remove damaged cords and equipment from service.",
        "Do not overload outlets or circuits.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/electrical#office",
  },
  {
    category: "Office & Ergonomics",
    title: "Workplace Stress & Mental Health",
    kind: "doc",
    provider: "NIOSH",
    bodyHtml: doc(
      "Job stress affects health, safety, and performance and can be managed at work.",
      [
        "Recognize signs of stress such as fatigue, irritability, and trouble concentrating.",
        "Take breaks and set realistic priorities.",
        "Use employer resources such as an Employee Assistance Program.",
        "Talk with a supervisor about workload concerns.",
      ],
      "National Institute for Occupational Safety and Health"
    ),
    sourceUrl: "https://www.cdc.gov/niosh/topics/stress/",
  },
  {
    category: "Office & Ergonomics",
    title: "Indoor Air Quality",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Poor indoor air quality can cause headaches, fatigue, and irritation.",
      [
        "Keep vents and returns unblocked.",
        "Report water leaks and visible mold promptly.",
        "Support adequate ventilation and fresh-air intake.",
        "Store chemicals and food properly to avoid odors and contamination.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/indoor-air-quality",
  },

  // ════════════════════════════ WORKPLACE CONDUCT ═════════════════════════════
  {
    category: "Workplace Conduct",
    title: "Preventing Workplace Violence",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Workplace violence is any act or threat of physical violence, harassment, intimidation, or threatening disruptive behavior at the work site.",
      [
        "Adopt a zero-tolerance policy toward workplace violence.",
        "Train staff to recognize warning signs and de-escalate conflict.",
        "Provide safety measures such as good lighting, alarms, and clear reporting channels.",
        "Encourage prompt reporting and investigate every incident and threat.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/workplace-violence",
  },
  {
    category: "Workplace Conduct",
    title: "Worker Safety & Health Rights",
    kind: "doc",
    provider: "DOL",
    bodyHtml: doc(
      "Workers are entitled to a safe and healthful workplace under the Occupational Safety and Health Act.",
      [
        "You have the right to working conditions that do not pose a risk of serious harm.",
        "You can receive information and training about hazards and prevention.",
        "You can review records of work-related injuries and illnesses.",
        "You can raise a safety concern or file an OSHA complaint without retaliation.",
      ],
      "U.S. Department of Labor / OSHA"
    ),
    sourceUrl: "https://www.dol.gov/general/topic/safety-health",
  },
  {
    category: "Workplace Conduct",
    title: "Harassment Prevention",
    kind: "doc",
    provider: "EEOC",
    bodyHtml: doc(
      "Harassment based on a protected characteristic is unlawful, and employers should prevent and correct it promptly.",
      [
        "Understand that harassment includes offensive conduct that becomes a condition of employment or is severe or pervasive.",
        "Treat coworkers, customers, and vendors with respect.",
        "Report harassment through the employer complaint process.",
        "Retaliation for reporting harassment is prohibited.",
      ],
      "U.S. Equal Employment Opportunity Commission"
    ),
    sourceUrl: "https://www.eeoc.gov/harassment",
  },
  {
    category: "Workplace Conduct",
    title: "Anti-Retaliation & Whistleblower Protections",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "It is illegal for an employer to retaliate against a worker for reporting a safety concern or exercising a protected right.",
      [
        "Protected activity includes reporting injuries, hazards, and violations.",
        "Retaliation includes firing, demotion, and other adverse actions.",
        "Complaints can be filed with OSHA within the deadline for the law involved.",
        "Keep records of the concern you raised and any response.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.whistleblowers.gov/",
  },
  {
    category: "Workplace Conduct",
    title: "Equal Employment & Anti-Discrimination",
    kind: "doc",
    provider: "EEOC",
    bodyHtml: doc(
      "Federal law prohibits employment discrimination based on protected characteristics.",
      [
        "Protected bases include race, color, religion, sex, national origin, age, disability, and genetic information.",
        "Discrimination is prohibited in hiring, pay, assignments, and other terms of employment.",
        "Reasonable accommodations may be required for disability and religion.",
        "Report concerns through the employer process or the EEOC.",
      ],
      "U.S. Equal Employment Opportunity Commission"
    ),
    sourceUrl: "https://www.eeoc.gov/prohibited-employment-policiespractices",
  },
  {
    category: "Workplace Conduct",
    title: "Drug-Free Workplace",
    kind: "doc",
    provider: "SAMHSA",
    bodyHtml: doc(
      "Alcohol and drug misuse affects safety and performance; a drug-free workplace program supports a healthy workforce.",
      [
        "Know the employer drug-free workplace policy.",
        "Never work while impaired.",
        "Understand how prescription medications may affect safety-sensitive tasks.",
        "Use confidential help resources such as an Employee Assistance Program.",
      ],
      "Substance Abuse and Mental Health Services Administration"
    ),
    sourceUrl: "https://www.samhsa.gov/workplace",
  },

  // ═════════════════════════ EMERGENCY PREPAREDNESS ═══════════════════════════
  {
    category: "Emergency Preparedness",
    title: "Emergency Action Plans",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "An emergency action plan covers the actions employers and workers must take to stay safe during a fire or other emergency.",
      [
        "Define reporting procedures, evacuation routes, and exits.",
        "Set procedures for workers who stay to operate critical operations before evacuating.",
        "Account for all employees after evacuation and identify rescue and medical duties.",
        "Name contacts for more information and train on the plan.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/emergency-preparedness",
  },
  {
    category: "Emergency Preparedness",
    title: "Prepare Your Business for Emergencies",
    kind: "doc",
    provider: "FEMA",
    bodyHtml: doc(
      "Every business should have a plan to protect employees, secure operations, and recover after an emergency.",
      [
        "Assess the risks most likely to affect your location and operations.",
        "Write an emergency plan and a business continuity plan and practice them.",
        "Build an emergency kit and set up multiple ways to communicate with staff.",
        "Back up records off-site and review coverage with your insurer.",
      ],
      "Ready.gov, U.S. Federal Emergency Management Agency"
    ),
    sourceUrl: "https://www.ready.gov/business",
  },
  {
    category: "Emergency Preparedness",
    title: "Fire Extinguisher Use (PASS)",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "A portable extinguisher can stop a small fire early, but only if used correctly and only when it is safe to do so.",
      [
        "Sound the alarm and make sure everyone is evacuating first.",
        "Use PASS: Pull the pin, Aim at the base, Squeeze the handle, Sweep side to side.",
        "Keep an exit at your back and only fight small, contained fires.",
        "Leave immediately if the fire grows or the room fills with smoke.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/fire-safety",
  },
  {
    category: "Emergency Preparedness",
    title: "First Aid & AED Readiness",
    kind: "doc",
    provider: "OSHA",
    bodyHtml: doc(
      "Quick first aid and access to an AED can save lives before emergency responders arrive.",
      [
        "Know where first-aid kits and the AED are located.",
        "Call 911 first for serious injuries or cardiac emergencies.",
        "Only trained responders should provide care beyond basic first aid.",
        "Report injuries so kits stay stocked and hazards get fixed.",
      ],
      "U.S. Occupational Safety and Health Administration"
    ),
    sourceUrl: "https://www.osha.gov/medical-first-aid",
  },
  {
    category: "Emergency Preparedness",
    title: "Severe Weather Preparedness",
    kind: "doc",
    provider: "FEMA",
    bodyHtml: doc(
      "Tornadoes, hurricanes, floods, and winter storms require plans that fit your location.",
      [
        "Know your shelter areas and the warning signals for your site.",
        "Keep emergency supplies and a way to receive alerts.",
        "Move away from windows during high winds and tornadoes.",
        "Never drive through flooded roads.",
      ],
      "Ready.gov, U.S. Federal Emergency Management Agency"
    ),
    sourceUrl: "https://www.ready.gov/severe-weather",
  },
  {
    category: "Emergency Preparedness",
    title: "Earthquake Safety at Work",
    kind: "doc",
    provider: "FEMA",
    bodyHtml: doc(
      "In an earthquake, protecting yourself in the first seconds matters most.",
      [
        "Drop, Cover, and Hold On under a sturdy desk or table.",
        "Stay away from windows and heavy items that can fall.",
        "Do not run outside during shaking.",
        "After shaking stops, evacuate carefully and watch for hazards.",
      ],
      "Ready.gov, U.S. Federal Emergency Management Agency"
    ),
    sourceUrl: "https://www.ready.gov/earthquakes",
  },
  {
    category: "Emergency Preparedness",
    title: "Evacuation Planning & Drills",
    kind: "doc",
    provider: "FEMA",
    bodyHtml: doc(
      "Practiced evacuations get everyone out quickly and safely.",
      [
        "Post evacuation maps and mark exits clearly.",
        "Assign helpers for visitors and people who need assistance.",
        "Hold drills and time them to find bottlenecks.",
        "Meet at the assembly point and take a head count.",
      ],
      "Ready.gov, U.S. Federal Emergency Management Agency"
    ),
    sourceUrl: "https://www.ready.gov/evacuation",
  },
];
