#!/usr/bin/env python3
"""
Builds the FIXTURE resumes behind the employer demo (public/demo-resumes/<key>.pdf) and prints the page-normalised
boxes of the sample highlights, which are pasted into lib/employer-demo.ts (DEMO_RESUME_ANNOTATIONS).

Every person is fictional (example.com addresses, RFC 2606). Standard-14 Helvetica on purpose: no font embedded, so each
file is ~2 KB and the demo also exercises the viewer's standard-font path. Run by hand if the sample candidates change:

    python3 -I scripts/build-demo-resumes.py
"""
import json
from pathlib import Path
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "public" / "demo-resumes"
OUT.mkdir(parents=True, exist_ok=True)
W, H = 612, 792

# key, name, headline, years line, jobs [(role, company, dates, [bullets])], school, skills, location
P = [
    ("maya", "Maya Okafor", "Customer Success Lead", "maya.okafor@example.com", "Austin, TX",
     "Customer Success leader with six years in B2B SaaS. Known for turning at-risk accounts into advocates.",
     [("Customer Success Lead", "Beacon Cloud", "2022 - Present", ["Reduced annual churn by 18% across a 140-account portfolio", "Built the renewal playbook now used by 9 CSMs", "Grew expansion revenue 27% through quarterly business reviews"]),
      ("Senior CSM", "Tallow Software", "2019 - 2022", ["Owned onboarding for 60 mid-market customers", "Cut time-to-value from 45 to 28 days"])],
     "University of Texas at Austin - BA Communication", ["Renewals", "QBRs", "Salesforce", "Gainsight", "Onboarding"]),
    ("liam", "Liam Hartmann", "Support Specialist", "liam.hartmann@example.com", "Denver, CO",
     "Support specialist with three years of tier-2 experience, now moving into account management.",
     [("Support Specialist II", "Northgate Systems", "2021 - Present", ["Resolved 40+ tickets a day with a 96% satisfaction score", "Wrote 30 help-center articles that deflected 12% of tickets"])],
     "Colorado State University - BS Business", ["Zendesk", "Troubleshooting", "Documentation", "Empathy"]),
    ("priya", "Priya Nair", "Account Manager", "priya.nair@example.com", "Chicago, IL",
     "Account manager with four years of strong renewals across the logistics and retail sectors.",
     [("Account Manager", "Meridian Freight Tech", "2021 - Present", ["Renewed 94% of a 2.3M dollar book of business", "Upsold analytics add-ons to 22 accounts"]),
      ("Customer Success Associate", "Parcelwise", "2019 - 2021", ["Handled onboarding for 35 SMB customers"])],
     "DePaul University - BBA Marketing", ["Renewals", "HubSpot", "Negotiation", "Reporting"]),
    ("carlos", "Carlos Mendes", "Onboarding Manager", "carlos.mendes@example.com", "Miami, FL",
     "Onboarding manager who has led more than forty enterprise launches without a missed go-live date.",
     [("Onboarding Manager", "Atlas Payments", "2020 - Present", ["Led 40+ enterprise implementations on schedule", "Created a launch checklist adopted company-wide", "Trained 12 new hires on the onboarding process"]),
      ("Implementation Specialist", "Coralbyte", "2017 - 2020", ["Configured integrations for 80 customers"])],
     "Florida International University - BS Management", ["Implementation", "Project plans", "APIs", "Training", "Jira"]),
    ("hana", "Hana Suzuki", "Customer Success Manager", "hana.suzuki@example.com", "San Francisco, CA",
     "CSM at a fintech scale-up. Fluent in English and Japanese; supports customers across both markets.",
     [("Customer Success Manager", "Kinetic Pay", "2021 - Present", ["Managed 55 accounts across the US and Japan", "Localised onboarding materials into Japanese", "Maintained 120% net revenue retention"])],
     "UC Berkeley - BA Economics", ["English", "Japanese", "Fintech", "Renewals", "SQL"]),
    ("tomas", "Tomas Novak", "Senior CSM", "tomas.novak@example.com", "Seattle, WA",
     "Senior CSM with seven years of experience and a reputation for calm, candid customer conversations.",
     [("Senior Customer Success Manager", "Lighthouse Data", "2019 - Present", ["Owned the top 20 enterprise accounts (8M dollars ARR)", "Ran executive business reviews with VP-level sponsors", "Mentored 4 junior CSMs"]),
      ("Customer Success Manager", "Pinecrest", "2016 - 2019", ["Improved NPS from 31 to 54"])],
     "University of Washington - BA Business", ["Enterprise", "Executive reviews", "NPS", "Mentoring"]),
    ("amara", "Amara Diallo", "Head of Customer Experience", "amara.diallo@example.com", "Atlanta, GA",
     "Customer experience executive who builds and leads success teams from five people to fifty.",
     [("Head of Customer Experience", "Brightleaf", "2018 - Present", ["Scaled the success team from 5 to 48 people", "Introduced health scoring that predicted 80% of churn", "Owns a 4.5M dollar annual budget"]),
      ("Director of Support", "Helix Apps", "2014 - 2018", ["Cut first-response time by 60%"])],
     "Georgia Tech - MS Management", ["Leadership", "Health scoring", "Budgeting", "Hiring", "Strategy"]),
    ("noah", "Noah Fischer", "Customer Success Manager", "noah.fischer@example.com", "Boston, MA",
     "Account executive turned customer success manager who knows both sides of the renewal conversation.",
     [("Customer Success Manager", "Verdant Software", "2024 - Present", ["Took over 35 accounts and renewed 31 in the first year"]),
      ("Account Executive", "Verdant Software", "2020 - 2024", ["Closed 1.1M dollars in new business", "Won the 2022 President's Club award"])],
     "Boston College - BS Marketing", ["Negotiation", "Forecasting", "CRM", "Customer advocacy"]),
]

# Which bullet each sample annotation sits on: (key, job index, bullet index)
HL = {"maya": [(0, 0)], "carlos": [(0, 0)], "hana": [(0, 0)]}
boxes = {}

for key, name, title, email, city, summary, jobs, school, skills in P:
    c = canvas.Canvas(str(OUT / f"{key}.pdf"), pagesize=(W, H), pageCompression=1)
    c.setTitle(f"{name} - resume (demo fixture)")
    c.setFont("Helvetica-Bold", 24); c.drawString(54, H - 70, name)
    c.setFont("Helvetica", 13); c.drawString(54, H - 90, title)
    c.setFont("Helvetica", 10); c.drawString(54, H - 108, f"{email}  |  {city}")
    c.setStrokeColorRGB(0.6, 0.6, 0.6); c.line(54, H - 118, W - 54, H - 118)
    y = H - 142
    c.setFont("Helvetica-Bold", 11); c.drawString(54, y, "SUMMARY"); y -= 16
    c.setFont("Helvetica", 10)
    words, line = summary.split(), ""
    for w in words:
        if c.stringWidth(line + w, "Helvetica", 10) > W - 108:
            c.drawString(54, y, line.strip()); y -= 13; line = ""
        line += w + " "
    c.drawString(54, y, line.strip()); y -= 26
    c.setFont("Helvetica-Bold", 11); c.drawString(54, y, "EXPERIENCE"); y -= 18
    for ji, (role, co, dates, bullets) in enumerate(jobs):
        c.setFont("Helvetica-Bold", 10.5); c.drawString(54, y, f"{role}, {co}")
        c.setFont("Helvetica", 10); c.drawRightString(W - 54, y, dates); y -= 14
        for bi, b in enumerate(bullets):
            text = "-  " + b
            c.drawString(62, y, text)
            if (ji, bi) in HL.get(key, []):
                tw = c.stringWidth(text, "Helvetica", 10)
                # box around the line: baseline y, ~9pt ascent, ~3pt descent
                boxes.setdefault(key, []).append({"page": 1, "x": round((62 - 2) / W, 4), "y": round((H - (y + 9.5)) / H, 4), "w": round((tw + 4) / W, 4), "h": round(13 / H, 4)})
            y -= 14
        y -= 8
    c.setFont("Helvetica-Bold", 11); c.drawString(54, y, "EDUCATION"); y -= 16
    c.setFont("Helvetica", 10); c.drawString(54, y, school); y -= 26
    c.setFont("Helvetica-Bold", 11); c.drawString(54, y, "SKILLS"); y -= 16
    c.setFont("Helvetica", 10); c.drawString(54, y, "  |  ".join(skills))
    c.showPage(); c.save()

print(json.dumps(boxes, indent=1))
