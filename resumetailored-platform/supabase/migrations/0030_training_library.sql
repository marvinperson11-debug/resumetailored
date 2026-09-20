-- Employee Hub — Built-in Training Library.
--
-- A curated, read-only library of FREE workplace-training content sourced only
-- from US-government, public-domain channels (OSHA / NIOSH / CDC / DOL / FEMA /
-- CISA / FDA / USDA). Videos are EMBEDDED (never downloaded) from the agency
-- official YouTube channel; docs carry an authored public-domain summary
-- plus an attribution link to the official source page.
--
-- Unlike the per-employer tables in 0029, the library is shared platform content:
-- RLS is ENABLED but there are NO policies, so it is reachable only through the
-- server service-role key (the same read path the stores already use). Clients
-- never query it directly.
--
-- This migration also links a training_docs row back to the library item it was
-- created from (training_docs.library_item_id), so a library video renders as an
-- embedded watch step while acknowledgment / signature / quiz tracking is
-- unchanged and source-agnostic.
--
-- HAND-APPLIED: run this against the Supabase project before deploying. It is
-- idempotent — `create ... if not exists`, an `add column if not exists`, and
-- each seed row guarded by `where not exists (... source_url ...)` — so it is
-- safe on a fresh or existing DB and safe to re-run (re-running never
-- duplicates seeds; edited seed rows are left as-is).

-- ── Library table ────────────────────────────────────────────────────────────
create table if not exists public.training_library_items (
  id bigint generated always as identity primary key,
  category text not null,
  title text not null,
  kind text not null default 'doc',            -- 'video' | 'doc'
  provider text not null,                        -- OSHA / NIOSH / DOL / FEMA / CISA / FDA / USDA / CDC
  embed_url text,                                -- YouTube iframe src (videos)
  body_html text,                                -- rendered content (docs)
  source_url text not null,                      -- attribution link (official gov source)
  created_at timestamptz not null default now()
);
create index if not exists training_library_category_idx on public.training_library_items (category, title);

-- Service-role only: RLS on, no policies (mirrors platform-content access).
alter table public.training_library_items enable row level security;

-- ── Link training_docs → library item ────────────────────────────────────────
alter table public.training_docs add column if not exists library_item_id bigint references public.training_library_items(id);
create index if not exists training_docs_library_idx on public.training_docs (library_item_id);

-- ── Seed (idempotent; each row guarded on its unique source_url) ──────────────
-- Videos — verified on each agency official YouTube channel (Sept 2026).
insert into public.training_library_items (category, title, kind, provider, embed_url, source_url)
select 'Safety — General', 'Protecting My Workers Against Noise Hazards', 'video', 'NIOSH', 'https://www.youtube-nocookie.com/embed/U4us4Ut2J7I', 'https://www.youtube.com/watch?v=U4us4Ut2J7I'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.youtube.com/watch?v=U4us4Ut2J7I');

insert into public.training_library_items (category, title, kind, provider, embed_url, source_url)
select 'Safety — General', 'NIOSH Health Hazard Evaluation: Measuring Air Contaminants at a Workplace', 'video', 'NIOSH', 'https://www.youtube-nocookie.com/embed/DFi9lZ_WfPg', 'https://www.youtube.com/watch?v=DFi9lZ_WfPg'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.youtube.com/watch?v=DFi9lZ_WfPg');

insert into public.training_library_items (category, title, kind, provider, embed_url, source_url)
select 'Emergency Preparedness', 'FEMA & Ready Campaign: Preparing Older Adults', 'video', 'FEMA', 'https://www.youtube-nocookie.com/embed/qZ2PJG97fdk', 'https://www.youtube.com/watch?v=qZ2PJG97fdk'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.youtube.com/watch?v=qZ2PJG97fdk');

insert into public.training_library_items (category, title, kind, provider, embed_url, source_url)
select 'Emergency Preparedness', 'Active Shooter Preparedness: Options for Consideration', 'video', 'CISA', 'https://www.youtube-nocookie.com/embed/i3QBktsRKVY', 'https://www.youtube.com/watch?v=i3QBktsRKVY'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.youtube.com/watch?v=i3QBktsRKVY');

insert into public.training_library_items (category, title, kind, provider, embed_url, source_url)
select 'Food Safety', 'How FDA Investigates Foodborne Illness Outbreaks', 'video', 'FDA', 'https://www.youtube-nocookie.com/embed/EeJwvAdJ-JU', 'https://www.youtube.com/watch?v=EeJwvAdJ-JU'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.youtube.com/watch?v=EeJwvAdJ-JU');

insert into public.training_library_items (category, title, kind, provider, embed_url, source_url)
select 'Food Safety', 'A Flash of Food Safety: Why to Wash Your Hands', 'video', 'USDA', 'https://www.youtube-nocookie.com/embed/7zWHkZI-7lg', 'https://www.youtube.com/watch?v=7zWHkZI-7lg'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.youtube.com/watch?v=7zWHkZI-7lg');

insert into public.training_library_items (category, title, kind, provider, embed_url, source_url)
select 'Food Safety', 'CDC in Action: Foodborne Outbreaks', 'video', 'CDC', 'https://www.youtube-nocookie.com/embed/iIaKWNZhz74', 'https://www.youtube.com/watch?v=iIaKWNZhz74'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.youtube.com/watch?v=iIaKWNZhz74');

-- Docs — authored public-domain summaries with attribution to the official page.
insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Safety — General', 'Fall Protection Basics', 'doc', 'OSHA',
'<h2>Fall Protection Basics</h2><p>Falls are a leading cause of serious work-related injuries and deaths. Employers must set up the workplace to prevent falls — from overhead platforms, elevated work stations, or into holes in the floor and walls.</p><ul><li>Guard every floor hole a worker can walk into (with a railing and toe-board or a floor-hole cover).</li><li>Provide a guardrail and toe-board around every elevated open-sided platform, floor, or runway.</li><li>Use guardrails, safety-harness/lanyard systems, or safety nets where the risk of falling exists.</li><li>Keep floors clean, dry, and free of tripping hazards; provide the right protective equipment at no cost.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>',
'https://www.osha.gov/fall-protection'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.osha.gov/fall-protection');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Safety — General', 'Personal Protective Equipment (PPE)', 'doc', 'OSHA',
'<h2>Personal Protective Equipment (PPE)</h2><p>PPE is equipment worn to minimize exposure to hazards that cause workplace injuries and illnesses — from contact with chemical, radiological, physical, electrical, mechanical, or other hazards.</p><ul><li>Assess the workplace to determine what hazards are present and what PPE is required.</li><li>Provide PPE (gloves, eye/face protection, hard hats, hearing protection, respirators, high-visibility clothing) and train workers on how to use it.</li><li>Ensure PPE fits properly and is kept clean and in working condition.</li><li>Replace worn or damaged PPE immediately.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>',
'https://www.osha.gov/personal-protective-equipment'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.osha.gov/personal-protective-equipment');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Safety — General', 'Hazard Communication & Chemical Safety', 'doc', 'OSHA',
'<h2>Hazard Communication (HazCom)</h2><p>Workers have the right to know and understand the hazardous chemicals they use. OSHA''s Hazard Communication Standard aligns with the Globally Harmonized System (GHS).</p><ul><li>Keep a written hazard-communication program and a list of hazardous chemicals on site.</li><li>Ensure every container is labeled with the product identifier and hazard warnings.</li><li>Maintain a Safety Data Sheet (SDS) for each hazardous chemical and make them accessible to all workers.</li><li>Train workers on the hazards, safe handling, and what to do in a spill or exposure.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>',
'https://www.osha.gov/hazard-communication'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.osha.gov/hazard-communication');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Safety — General', 'Forklift & Powered Industrial Truck Safety', 'doc', 'OSHA',
'<h2>Forklift &amp; Powered Industrial Truck Safety</h2><p>Only trained and evaluated operators may drive a forklift. Employers must certify each operator and re-evaluate them at least every three years.</p><ul><li>Complete formal instruction, hands-on training, and a workplace evaluation before operating.</li><li>Inspect the truck before each shift; take an unsafe truck out of service.</li><li>Obey speed limits, keep loads low and tilted back, and never carry passengers.</li><li>Watch for pedestrians, sound the horn at intersections, and never exceed the rated load capacity.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>',
'https://www.osha.gov/powered-industrial-trucks'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.osha.gov/powered-industrial-trucks');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Safety — General', 'Preventing Heat Illness at Work', 'doc', 'OSHA',
'<h2>Preventing Heat Illness</h2><p>Workers exposed to hot indoor or outdoor environments can suffer heat illness, which can be fatal. Prevention comes down to <strong>water, rest, and shade</strong>.</p><ul><li>Drink water every 15 minutes, even if not thirsty.</li><li>Rest in the shade to cool down; new and returning workers need to acclimatize gradually.</li><li>Watch for symptoms — dizziness, confusion, heavy sweating or no sweating, nausea.</li><li>Know what to do in an emergency and call 911 for signs of heat stroke.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>',
'https://www.osha.gov/heat'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.osha.gov/heat');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Safety — General', 'Bloodborne Pathogens', 'doc', 'OSHA',
'<h2>Bloodborne Pathogens</h2><p>Workers who may contact blood or other potentially infectious materials are at risk of exposure to bloodborne pathogens such as HBV, HCV, and HIV.</p><ul><li>Follow the employer''s written Exposure Control Plan and use universal precautions.</li><li>Use PPE (gloves, gowns, eye protection) and engineering controls such as sharps containers.</li><li>Handle and dispose of sharps and contaminated materials safely.</li><li>Report exposures immediately; the Hepatitis B vaccine is offered at no cost to at-risk workers.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>',
'https://www.osha.gov/bloodborne-pathogens'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.osha.gov/bloodborne-pathogens');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Emergency Preparedness', 'Emergency Action Plans', 'doc', 'OSHA',
'<h2>Emergency Action Plans (EAP)</h2><p>An emergency action plan covers the actions employers and workers must take to ensure safety during a fire or other emergency.</p><ul><li>Define reporting procedures, evacuation routes, and exits.</li><li>Establish procedures for workers who stay to operate critical operations before they evacuate.</li><li>Account for all employees after evacuation, and identify rescue/medical duties.</li><li>Name people workers can contact for more information, and train on the plan.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>',
'https://www.osha.gov/emergency-preparedness'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.osha.gov/emergency-preparedness');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Emergency Preparedness', 'Prepare Your Business for Emergencies', 'doc', 'FEMA',
'<h2>Prepare Your Business for Emergencies</h2><p>Every business should have a plan to protect employees, secure operations, and recover after an emergency.</p><ul><li>Assess the risks most likely to affect your location and operations.</li><li>Write an emergency plan and a business continuity plan; practice them.</li><li>Build an emergency kit and set up multiple ways to communicate with staff.</li><li>Back up records off-site and review coverage with your insurer.</li></ul><p>Source: Ready.gov, U.S. Federal Emergency Management Agency (public domain).</p>',
'https://www.ready.gov/business'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.ready.gov/business');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Workplace Conduct', 'Preventing Workplace Violence', 'doc', 'OSHA',
'<h2>Preventing Workplace Violence</h2><p>Workplace violence is any act or threat of physical violence, harassment, intimidation, or other threatening disruptive behavior at the work site.</p><ul><li>Adopt a zero-tolerance policy toward workplace violence.</li><li>Train staff to recognize warning signs and de-escalate conflict.</li><li>Provide safety measures — good lighting, alarms, and clear reporting channels.</li><li>Encourage prompt reporting; investigate every incident and threat.</li></ul><p>Source: U.S. Occupational Safety and Health Administration (public domain).</p>',
'https://www.osha.gov/workplace-violence'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.osha.gov/workplace-violence');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Workplace Conduct', 'Worker Safety & Health Rights', 'doc', 'DOL',
'<h2>Worker Safety &amp; Health Rights</h2><p>Workers are entitled to a safe and healthful workplace under the Occupational Safety and Health Act.</p><ul><li>You have the right to working conditions that do not pose a risk of serious harm.</li><li>You can receive information and training about hazards and prevention.</li><li>You can review records of work-related injuries and illnesses.</li><li>You can raise a safety concern or file an OSHA complaint without retaliation.</li></ul><p>Source: U.S. Department of Labor / OSHA (public domain).</p>',
'https://www.dol.gov/general/topic/safety-health'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.dol.gov/general/topic/safety-health');

insert into public.training_library_items (category, title, kind, provider, body_html, source_url)
select 'Food Safety', 'Food Safety Basics: Clean, Separate, Cook, Chill', 'doc', 'FDA',
'<h2>Food Safety Basics</h2><p>Four simple steps prevent most foodborne illness: <strong>Clean, Separate, Cook, and Chill.</strong></p><ul><li><strong>Clean:</strong> wash hands for 20 seconds and sanitize surfaces and utensils often.</li><li><strong>Separate:</strong> keep raw meat, poultry, seafood, and eggs away from ready-to-eat foods.</li><li><strong>Cook:</strong> use a food thermometer to reach safe internal temperatures.</li><li><strong>Chill:</strong> refrigerate promptly at 40&deg;F or below; never thaw food on the counter.</li></ul><p>Source: FoodSafety.gov (HHS / USDA / FDA, public domain).</p>',
'https://www.foodsafety.gov/keep-food-safe/4-steps-to-food-safety'
where not exists (select 1 from public.training_library_items where source_url = 'https://www.foodsafety.gov/keep-food-safe/4-steps-to-food-safety');
