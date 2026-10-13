#!/usr/bin/env python3
"""
Builds the resume-viewer fidelity corpus (fidelity/corpus/*.pdf + fidelity/manifest.json).

Run by hand when the corpus needs regenerating — CI only CONSUMES the committed PDFs
(scripts/test-resume-fidelity.cjs), so it needs none of the tools below:

    python3 -I fidelity/build-corpus.py [--fonts DIR]    # reportlab, python-docx, Pillow,
                                                        # LibreOffice (soffice), Chromium

Every person in the corpus is FICTIONAL — no real candidate data is committed. Each document is
made by the same kind of producer a real candidate uses, so the PDF structure (font embedding,
text-run granularity, tables vs absolute positioning, image-only pages) is what the viewer meets:

  word      DOCX -> PDF through LibreOffice (Word-style layout: tables, headers/footers, bullets)
  gdocs     HTML -> PDF through Chromium's print path. Chromium's PDF backend is Skia/PDF, the SAME
            producer Google Docs exports with
  canva     absolute-positioned graphics (colour sidebars, shapes, rotated labels, many small text runs)
            written directly with reportlab
  nonembed  reportlab's standard-14 fonts and the Adobe-GB1 CID font: NOT embedded, so the viewer
            has to substitute (the classic way a resume gets mangled)
  scan      a rasterised page re-saved as an image-only PDF (no text layer, slight skew + noise)

HONEST LIMIT: these are structural stand-ins. A PDF exported by Microsoft Word, Canva or Google Docs
themselves could not be obtained in the build sandbox. Drop real exports into fidelity/corpus/ and add
manifest entries to widen the gate (see fidelity/README.md) — the gate takes any PDF.
"""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "corpus"
CORPUS.mkdir(exist_ok=True)

# ── fictional people ─────────────────────────────────────────────────────────
EN = [
    dict(name="Dana Whitfield", title="Senior Product Manager", email="dana.whitfield@example.com", phone="+1 (555) 014-2290",
         city="Austin, TX", summary="Product leader with nine years shipping B2B analytics tools. Grew weekly active teams from 4,000 to 31,000.",
         jobs=[("Northwind Analytics", "Senior Product Manager", "2021 - Present", ["Launched the self-serve dashboard builder used by 12,000 teams", "Cut onboarding time by 38 percent through guided setup", "Managed a roadmap across 3 squads and 14 engineers"]),
               ("Brightpath Software", "Product Manager", "2017 - 2021", ["Owned the billing platform migration to usage-based pricing", "Ran 60 customer interviews per quarter to shape the roadmap"]),
               ("Cobalt Labs", "Associate Product Manager", "2015 - 2017", ["Shipped the first mobile app, reaching 80,000 downloads in six months"])],
         edu=[("University of Texas at Austin", "BBA Management Information Systems", "2015")],
         skills=["Roadmapping", "SQL", "A/B testing", "Stakeholder management", "Figma", "Jira"]),
    dict(name="Marcus Okoye", title="Registered Nurse, ICU", email="marcus.okoye@example.com", phone="+1 (555) 019-7741",
         city="Columbus, OH", summary="Critical care nurse with eight years in a 32-bed medical ICU. Preceptor for new graduate nurses.",
         jobs=[("St. Aldric Medical Center", "Charge Nurse, Medical ICU", "2019 - Present", ["Coordinate care for 32 beds across 4 shifts", "Reduced central line infections by 22 percent with a new bundle checklist", "Precepted 15 new graduate nurses"]),
               ("Lakeview Community Hospital", "Staff Nurse, Step-Down", "2016 - 2019", ["Managed 5 patients per shift with complex telemetry needs", "Led the unit falls-prevention committee"])],
         edu=[("Ohio State University", "BSN Nursing", "2016")],
         skills=["BLS / ACLS", "Ventilator management", "Epic", "Patient education", "Triage", "Team leadership"]),
    dict(name="Priya Raman", title="Full-Stack Software Engineer", email="priya.raman@example.com", phone="+1 (555) 013-5568",
         city="Seattle, WA", summary="Engineer who builds reliable web platforms. Led a payments rewrite that handles 2 million requests a day.",
         jobs=[("Tidewater Systems", "Staff Engineer", "2022 - Present", ["Led the payments service rewrite in Go and TypeScript", "Brought p99 latency from 900 ms to 120 ms", "Mentored 6 engineers across two teams"]),
               ("Harbor Cloud", "Software Engineer II", "2018 - 2022", ["Built the event pipeline processing 40 million messages daily", "Introduced contract testing across 11 services"])],
         edu=[("University of Washington", "BS Computer Science", "2018")],
         skills=["TypeScript", "Go", "PostgreSQL", "Kubernetes", "System design", "Mentoring"]),
    dict(name="Elena Petrova", title="Marketing Operations Manager", email="elena.petrova@example.com", phone="+1 (555) 017-3302",
         city="Chicago, IL", summary="Marketing operations lead who turns messy funnels into measurable pipeline. Increased qualified leads 54 percent.",
         jobs=[("Lumen Retail Group", "Marketing Operations Manager", "2020 - Present", ["Rebuilt lead scoring and routing in HubSpot", "Increased marketing-sourced pipeline by 54 percent", "Owns a 1.2 million dollar annual tooling budget"]),
               ("Ardent Media", "Campaign Analyst", "2016 - 2020", ["Produced weekly attribution reports for 9 executives", "Automated 20 hours of manual reporting each week"])],
         edu=[("DePaul University", "BA Marketing", "2016")],
         skills=["HubSpot", "Salesforce", "Attribution", "SQL", "Budgeting", "Project management"]),
]
ZH = [
    dict(name="李明辉", title="高级软件工程师", email="liminghui@example.com", phone="138-0000-1234", city="上海",
         summary="拥有八年后端开发经验，擅长高并发系统设计与性能优化，带领团队完成多个核心系统重构。",
         jobs=[("星辰科技有限公司", "高级软件工程师", "2020年3月 - 至今", ["负责订单系统重构，日均处理请求两千万次", "将接口平均响应时间从八百毫秒降低到一百二十毫秒", "指导五名初级工程师并建立代码评审流程"]),
               ("云帆网络股份有限公司", "软件工程师", "2016年7月 - 2020年2月", ["开发并维护支付网关，保障全年零重大事故", "引入自动化测试，使发布周期缩短百分之四十"])],
         edu=[("复旦大学", "计算机科学与技术 本科", "2016年")],
         skills=["Java", "Go", "MySQL", "Redis", "微服务架构", "团队协作"]),
    dict(name="王雅婷", title="产品运营经理", email="wangyating@example.com", phone="139-0000-5678", city="北京",
         summary="六年互联网产品运营经验，专注用户增长与留存，主导多个百万级用户活动，具备数据驱动的决策能力。",
         jobs=[("华信互联网有限公司", "产品运营经理", "2021年1月 - 至今", ["主导会员体系改版，付费转化率提升百分之三十五", "策划年度大型活动，吸引新增用户一百二十万", "搭建数据看板，每周向管理层汇报核心指标"]),
               ("蓝海电子商务公司", "运营专员", "2017年6月 - 2020年12月", ["负责社群运营，月活跃用户增长至十万", "优化客服流程，将满意度提高到百分之九十五"])],
         edu=[("北京大学", "市场营销 硕士", "2017年")],
         skills=["用户增长", "数据分析", "活动策划", "项目管理", "SQL", "沟通协调"]),
]

manifest = []

def add(file, family, lang, pages, text, anchors=None, scan=False, real=False, note=""):
    manifest.append(dict(id=Path(file).stem, file=file, family=family, lang=lang, pages=pages,
                         expectText=text, anchors=anchors or [], scan=scan, real=real, note=note))

def core_phrases(p):
    """Short phrases that must survive extraction, whatever the layout."""
    j = p["jobs"][0]
    return [p["name"], p["title"], p["email"], j[0], j[1], j[3][0][:18], p["edu"][0][0], p["skills"][0], p["skills"][2]]

# ── Word-style: DOCX -> PDF via LibreOffice ──────────────────────────────────
def build_docx(p, kind, path, zh=False):
    from docx import Document
    from docx.shared import Pt, RGBColor, Inches
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    d = Document()
    sec = d.sections[0]
    sec.left_margin = sec.right_margin = Inches(0.8)
    sec.top_margin = sec.bottom_margin = Inches(0.7)
    font = "Noto Sans SC" if zh else "Calibri"
    st = d.styles["Normal"]
    st.font.name = font
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), "Noto Sans SC")

    def shade(cell, hexcolor):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hexcolor)
        tcPr.append(shd)

    def head(container, text, size=12):
        para = container.add_paragraph()
        r = para.add_run(text.upper() if not zh else text)
        r.bold = True; r.font.size = Pt(size); r.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
        return para

    def body(container, p):
        container.add_paragraph(p["summary"])
        head(container, "经历" if zh else "Experience")
        for co, role, dates, bullets in p["jobs"]:
            para = container.add_paragraph()
            r = para.add_run(f"{role}, {co}" if not zh else f"{role}，{co}"); r.bold = True
            para.add_run(f"   {dates}")
            for b in bullets:
                container.add_paragraph(b, style="List Bullet")

    if kind == "single":
        h = d.add_paragraph(); r = h.add_run(p["name"]); r.bold = True; r.font.size = Pt(22)
        d.add_paragraph(p["title"])
        d.add_paragraph(f'{p["email"]}  |  {p["phone"]}  |  {p["city"]}')
        body(d, p)
        head(d, "教育" if zh else "Education")
        for school, deg, yr in p["edu"]:
            d.add_paragraph(f"{school} — {deg} ({yr})")
        head(d, "技能" if zh else "Skills")
        d.add_paragraph(" · ".join(p["skills"]))
    elif kind == "sidebar":
        t = d.add_table(rows=1, cols=2)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        left, right = t.rows[0].cells
        left.width = Inches(2.1); right.width = Inches(4.8)
        shade(left, "E8EEF5")
        left.paragraphs[0].add_run(p["name"]).bold = True
        left.paragraphs[0].runs[0].font.size = Pt(16)
        left.add_paragraph(p["title"])
        head(left, "联系方式" if zh else "Contact", 10)
        for line in (p["email"], p["phone"], p["city"]):
            left.add_paragraph(line)
        head(left, "技能" if zh else "Skills", 10)
        for s in p["skills"]:
            left.add_paragraph(s)
        head(left, "教育" if zh else "Education", 10)
        for school, deg, yr in p["edu"]:
            left.add_paragraph(f"{school}\n{deg}\n{yr}")
        right.paragraphs[0].add_run("")
        body(right, p)
    elif kind == "multipage":
        hdr = sec.header.paragraphs[0]; hdr.text = f'{p["name"]} — Resume'
        ftr = sec.footer.paragraphs[0]; ftr.text = "Confidential — references available on request"
        h = d.add_paragraph(); r = h.add_run(p["name"]); r.bold = True; r.font.size = Pt(20)
        d.add_paragraph(f'{p["title"]}  |  {p["email"]}')
        body(d, p)
        for i in range(2):  # pad to a second page with a long project list
            head(d, f"Selected projects {i + 1}")
            for k in range(14):
                d.add_paragraph(f"Project {i + 1}.{k + 1}: delivered a measurable improvement for the {p['jobs'][0][0]} team with clear owner and result.", style="List Bullet")
        head(d, "Education")
        for school, deg, yr in p["edu"]:
            d.add_paragraph(f"{school} — {deg} ({yr})")
        head(d, "Skills"); d.add_paragraph(", ".join(p["skills"]))
    elif kind == "table":
        h = d.add_paragraph(); r = h.add_run(p["name"]); r.bold = True; r.font.size = Pt(20)
        d.add_paragraph(f'{p["title"]}  |  {p["email"]}  |  {p["phone"]}')
        d.add_paragraph(p["summary"])
        head(d, "Skills matrix")
        t = d.add_table(rows=1, cols=3); t.style = "Table Grid"
        for i, label in enumerate(("Skill", "Level", "Years")):
            t.rows[0].cells[i].text = label
            shade(t.rows[0].cells[i], "D9E2F3")
        for i, s in enumerate(p["skills"]):
            row = t.add_row().cells
            row[0].text = s; row[1].text = ("Expert", "Advanced", "Proficient")[i % 3]; row[2].text = str(3 + i)
        head(d, "Experience")
        for co, role, dates, bullets in p["jobs"]:
            para = d.add_paragraph(); para.add_run(f"{role}, {co}").bold = True; para.add_run(f"   {dates}")
            for b in bullets:
                d.add_paragraph(b, style="List Bullet")
        head(d, "Education")
        for school, deg, yr in p["edu"]:
            d.add_paragraph(f"{school} — {deg} ({yr})")
    d.save(path)

def docx_to_pdf(docx, outdir):
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(docx)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)

# ── Google-Docs-style: Chromium print (Skia/PDF) ─────────────────────────────
def html_resume(p, kind, zh=False):
    font = "'Noto Sans SC', sans-serif" if zh else "Arial, 'Liberation Sans', sans-serif"
    lab = dict(exp="工作经历" if zh else "Experience", edu="教育背景" if zh else "Education", skills="技能" if zh else "Skills", contact="联系方式" if zh else "Contact")
    jobs = "".join(
        f'<h3>{r}, {c} <span class="d">{d}</span></h3><ul>' + "".join(f"<li>{b}</li>" for b in bl) + "</ul>"
        for c, r, d, bl in p["jobs"])
    edu = "".join(f"<p><b>{s}</b><br>{g} ({y})</p>" for s, g, y in p["edu"])
    skills = "".join(f"<li>{s}</li>" for s in p["skills"])
    css = f"""@page{{size:Letter;margin:0.6in}}body{{font-family:{font};font-size:10.5pt;color:#222;margin:0}}
h1{{font-size:24pt;margin:0}}h2{{font-size:12pt;border-bottom:1px solid #999;margin:14px 0 6px;color:#1f3a5f}}h3{{font-size:11pt;margin:8px 0 2px}}
.d{{float:right;font-weight:normal;color:#555}}ul{{margin:2px 0 6px 18px;padding:0}}a{{color:#1155cc}}
.grid{{display:grid;grid-template-columns:{'1fr 2.2fr' if kind=='twocol' else '1fr'};gap:24px}}.side{{background:#f1f4f9;padding:12px}}
table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #bbb;padding:4px 8px;text-align:left}}"""
    contact = f'<p>{p["email"]}<br>{p["phone"]}<br>{p["city"]}</p>'
    if kind == "twocol":
        inner = f'<div class="grid"><div class="side"><h2>{lab["contact"]}</h2>{contact}<h2>{lab["skills"]}</h2><ul>{skills}</ul><h2>{lab["edu"]}</h2>{edu}</div><div><h2>{lab["exp"]}</h2><p>{p["summary"]}</p>{jobs}</div></div>'
    elif kind == "table":
        rows = "".join(f"<tr><td>{c}</td><td>{r}</td><td>{d}</td></tr>" for c, r, d, _ in p["jobs"])
        inner = f'{contact}<p>{p["summary"]}</p><h2>{lab["exp"]}</h2><table><tr><th>{"公司" if zh else "Company"}</th><th>{"职位" if zh else "Role"}</th><th>{"时间" if zh else "Dates"}</th></tr>{rows}</table>{jobs}<h2>{lab["edu"]}</h2>{edu}<h2>{lab["skills"]}</h2><ul>{skills}</ul>'
    elif kind == "multipage":
        extra = "".join(f"<li>Initiative {i}: led a cross-functional effort with a documented outcome for {p['jobs'][0][0]}.</li>" for i in range(1, 46))
        inner = f'{contact}<h2>{lab["exp"]}</h2><p>{p["summary"]}</p>{jobs}<h2>Initiatives</h2><ul>{extra}</ul><h2>{lab["edu"]}</h2>{edu}<h2>{lab["skills"]}</h2><ul>{skills}</ul>'
    else:  # links + bullets, single column
        inner = f'{contact}<p><a href="https://example.com/{p["name"].split()[0].lower() if not zh else "me"}">portfolio</a></p><h2>{lab["exp"]}</h2><p>{p["summary"]}</p>{jobs}<h2>{lab["edu"]}</h2>{edu}<h2>{lab["skills"]}</h2><ul>{skills}</ul>'
    return f'<!doctype html><html lang="{"zh" if zh else "en"}"><meta charset="utf-8"><style>{css}</style><body><h1>{p["name"]}</h1><div>{p["title"]}</div>{inner}</body></html>'

def chromium_pdf(html, out):
    chrome = next((c for c in ("/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", shutil.which("chromium"), shutil.which("google-chrome")) if c and os.path.exists(c)), None)
    if not chrome:
        raise SystemExit("no Chromium found for the gdocs-style documents")
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "r.html"; f.write_text(html, encoding="utf-8")
        subprocess.run([chrome, "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={out}", f"file://{f}"],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)

# ── Canva-style + non-embedded: reportlab ────────────────────────────────────
def rl_canvas(path):
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    return canvas.Canvas(str(path), pagesize=letter, pageCompression=1)

def reg_ttf():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    base = "/usr/share/fonts/truetype"
    for name, rel in (("Carlito", "crosextra/Carlito-Regular.ttf"), ("Carlito-Bold", "crosextra/Carlito-Bold.ttf"),
                      ("DejaVuSerif", "dejavu/DejaVuSerif.ttf"), ("DejaVuSerif-Bold", "dejavu/DejaVuSerif-Bold.ttf"),
                      ("LiberationSans", "liberation/LiberationSans-Regular.ttf"), ("LiberationSans-Bold", "liberation/LiberationSans-Bold.ttf")):
        try:
            pdfmetrics.registerFont(TTFont(name, f"{base}/{rel}"))
        except Exception:
            pass

def canva_sidebar(p, path, accent=(0.12, 0.23, 0.37)):
    c = rl_canvas(path); W, H = 612, 792
    c.setFillColorRGB(*accent); c.rect(0, 0, 200, H, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1); c.circle(100, H - 90, 46, stroke=0, fill=1)               # photo placeholder
    c.setFillColorRGB(*accent); c.setFont("Carlito-Bold", 26); c.drawCentredString(100, H - 98, "".join(w[0] for w in p["name"].split()))
    c.setFillColorRGB(1, 1, 1); c.setFont("Carlito-Bold", 11)
    y = H - 180
    for label, vals in (("CONTACT", [p["email"], p["phone"], p["city"]]), ("SKILLS", p["skills"])):
        c.setFont("Carlito-Bold", 11); c.drawString(24, y, label); y -= 16
        c.setFont("Carlito", 10)
        for v in vals:
            c.drawString(24, y, v); y -= 14
        y -= 14
    c.setFillColorRGB(0.1, 0.1, 0.1); c.setFont("Carlito-Bold", 30); c.drawString(224, H - 80, p["name"])
    c.setFont("Carlito", 14); c.setFillColorRGB(0.35, 0.35, 0.35); c.drawString(224, H - 102, p["title"].upper())
    y = H - 150
    c.setStrokeColorRGB(*accent); c.setLineWidth(1.5); c.line(224, y + 14, W - 40, y + 14)
    c.setFillColorRGB(*accent); c.setFont("Carlito-Bold", 13); c.drawString(224, y, "EXPERIENCE"); y -= 22
    for co, role, dates, bullets in p["jobs"]:
        c.setFillColorRGB(0.1, 0.1, 0.1); c.setFont("Carlito-Bold", 12); c.drawString(224, y, f"{role} · {co}"); y -= 14
        c.setFont("Carlito", 10); c.setFillColorRGB(0.4, 0.4, 0.4); c.drawString(224, y, dates); y -= 14
        c.setFillColorRGB(0.15, 0.15, 0.15)
        for b in bullets:
            c.drawString(232, y, "•  " + b[:62]); y -= 13
            if len(b) > 62:
                c.drawString(244, y, b[62:]); y -= 13
        y -= 10
    c.setFillColorRGB(*accent); c.setFont("Carlito-Bold", 13); c.drawString(224, y, "EDUCATION"); y -= 20
    c.setFillColorRGB(0.1, 0.1, 0.1); c.setFont("Carlito", 10.5)
    for s, g, yr in p["edu"]:
        c.drawString(224, y, f"{s} — {g} ({yr})"); y -= 14
    c.showPage(); c.save()

def canva_banner(p, path):
    c = rl_canvas(path); W, H = 612, 792
    c.setFillColorRGB(0.95, 0.88, 0.8); c.rect(0, H - 150, W, 150, stroke=0, fill=1)
    c.setFillColorRGB(0.82, 0.45, 0.2); c.rect(0, H - 156, W, 6, stroke=0, fill=1)
    c.setFillColorRGB(0.2, 0.15, 0.1); c.setFont("DejaVuSerif-Bold", 28); c.drawString(40, H - 70, p["name"])
    c.setFont("DejaVuSerif", 13); c.drawString(40, H - 96, p["title"])
    c.setFont("LiberationSans", 9.5); c.drawString(40, H - 124, f'{p["email"]}   {p["phone"]}   {p["city"]}')
    y = H - 190
    cols = (40, 330)
    c.setFillColorRGB(0.82, 0.45, 0.2); c.setFont("LiberationSans-Bold", 12); c.drawString(cols[0], y, "PROFILE"); c.drawString(cols[1], y, "SKILLS")
    c.setFillColorRGB(0.2, 0.15, 0.1); c.setFont("LiberationSans", 10)
    words = p["summary"].split(); line = ""; yy = y - 18
    for w in words:
        if len(line + w) > 44:
            c.drawString(cols[0], yy, line.strip()); yy -= 13; line = ""
        line += w + " "
    c.drawString(cols[0], yy, line.strip())
    for i, s in enumerate(p["skills"]):
        c.setFillColorRGB(0.95, 0.88, 0.8); c.roundRect(cols[1], y - 30 - i * 26, 150, 18, 9, stroke=0, fill=1)
        c.setFillColorRGB(0.2, 0.15, 0.1); c.drawString(cols[1] + 10, y - 25 - i * 26, s)
    y -= 200
    c.setFillColorRGB(0.82, 0.45, 0.2); c.setFont("LiberationSans-Bold", 12); c.drawString(40, y, "EXPERIENCE"); y -= 22
    for co, role, dates, bullets in p["jobs"]:
        c.setFillColorRGB(0.2, 0.15, 0.1); c.setFont("LiberationSans-Bold", 11); c.drawString(40, y, role); c.setFont("LiberationSans", 11); c.drawString(40 + 160, y, co)
        c.drawRightString(W - 40, y, dates); y -= 15
        c.setFont("LiberationSans", 10)
        for b in bullets:
            c.drawString(52, y, "–  " + b[:88]); y -= 13
        y -= 8
    c.setFillColorRGB(0.82, 0.45, 0.2); c.setFont("LiberationSans-Bold", 12); c.drawString(40, y, "EDUCATION"); y -= 18
    c.setFillColorRGB(0.2, 0.15, 0.1); c.setFont("LiberationSans", 10)
    for sch, deg, yr in p["edu"]:
        c.drawString(40, y, f"{sch} — {deg} ({yr})"); y -= 13
    c.showPage(); c.save()

def canva_timeline(p, path):
    c = rl_canvas(path); W, H = 612, 792
    c.setFillColorRGB(0.1, 0.1, 0.12); c.setFont("LiberationSans-Bold", 30); c.drawString(50, H - 70, p["name"])
    c.setFont("LiberationSans", 13); c.setFillColorRGB(0.4, 0.4, 0.45); c.drawString(50, H - 92, p["title"])
    c.setFont("LiberationSans", 9.5); c.drawString(50, H - 112, f'{p["email"]}  ·  {p["phone"]}')
    x = 90; y = H - 170
    c.setStrokeColorRGB(0.6, 0.7, 0.9); c.setLineWidth(2); c.line(x, y + 10, x, 140)
    for co, role, dates, bullets in p["jobs"]:
        c.setFillColorRGB(0.25, 0.4, 0.85); c.circle(x, y + 4, 6, stroke=0, fill=1)
        c.saveState(); c.translate(52, y - 40); c.rotate(90); c.setFont("LiberationSans", 8); c.setFillColorRGB(0.5, 0.5, 0.55); c.drawString(0, 0, dates); c.restoreState()
        c.setFillColorRGB(0.1, 0.1, 0.12); c.setFont("LiberationSans-Bold", 12); c.drawString(x + 22, y, f"{role}")
        c.setFont("LiberationSans", 11); c.setFillColorRGB(0.25, 0.4, 0.85); c.drawString(x + 22, y - 14, co)
        c.setFont("LiberationSans", 10); c.setFillColorRGB(0.2, 0.2, 0.25)
        yy = y - 30
        for b in bullets:
            c.drawString(x + 22, yy, b[:80]); yy -= 13
        y = yy - 22
    c.setFont("LiberationSans-Bold", 12); c.setFillColorRGB(0.1, 0.1, 0.12); c.drawString(50, 112, "EDUCATION")
    c.setFont("LiberationSans", 10); s, g, yr = p["edu"][0]; c.drawString(50, 96, f"{s} — {g} ({yr})")
    c.drawString(50, 76, "Skills: " + ", ".join(p["skills"]))
    c.showPage(); c.save()

def canva_grid(p, path):
    """Many tiny absolutely-positioned runs: each word placed separately (what some editors export)."""
    c = rl_canvas(path); W, H = 612, 792
    c.setFont("Carlito-Bold", 26); c.drawString(48, H - 70, p["name"])
    c.setFont("Carlito", 12); c.drawString(48, H - 92, p["title"]); c.drawString(48, H - 108, f'{p["email"]} | {p["phone"]}')
    y = H - 150
    for co, role, dates, bullets in p["jobs"]:
        c.setFont("Carlito-Bold", 12); c.drawString(48, y, f"{role}, {co}"); y -= 15
        c.setFont("Carlito", 10.5)
        for b in bullets:
            x = 60
            for w in ("•", *b.split()):
                c.drawString(x, y, w); x += c.stringWidth(w + " ", "Carlito", 10.5)
            y -= 14
        y -= 10
    c.setFont("Carlito-Bold", 12); c.drawString(48, y, "Education"); y -= 15; c.setFont("Carlito", 10.5)
    s, g, yr = p["edu"][0]; c.drawString(48, y, f"{s}, {g}, {yr}"); y -= 24
    c.setFont("Carlito-Bold", 12); c.drawString(48, y, "Skills"); y -= 15; c.setFont("Carlito", 10.5); c.drawString(48, y, "; ".join(p["skills"]))
    c.showPage(); c.save()

def nonembedded(p, path, kind):
    c = rl_canvas(path); W, H = 612, 792
    f, fb = {"helv": ("Helvetica", "Helvetica-Bold"), "times": ("Times-Roman", "Times-Bold"), "courier": ("Courier", "Courier-Bold")}[kind]
    if kind == "times":                                           # two columns, the other two single
        c.setFont(fb, 22); c.drawString(48, H - 60, p["name"]); c.setFont(f, 12); c.drawString(48, H - 78, p["title"] + "  |  " + p["email"])
        lx, rx = 48, 250; yl = yr = H - 120
        c.setFont(fb, 12); c.drawString(lx, yl, "Skills"); yl -= 16; c.setFont(f, 10.5)
        for s in p["skills"]:
            c.drawString(lx, yl, s); yl -= 14
        yl -= 10; c.setFont(fb, 12); c.drawString(lx, yl, "Education"); yl -= 16; c.setFont(f, 10.5)
        for s, g, yv in p["edu"]:
            c.drawString(lx, yl, s); yl -= 13; c.drawString(lx, yl, f"{g} {yv}"); yl -= 18
        c.setFont(fb, 12); c.drawString(rx, yr, "Experience"); yr -= 18
        for co, role, dates, bullets in p["jobs"]:
            c.setFont(fb, 11); c.drawString(rx, yr, f"{role}, {co}"); yr -= 14; c.setFont(f, 10.5); c.drawString(rx, yr, dates); yr -= 14
            for b in bullets:
                c.drawString(rx, yr, "- " + b[:55]); yr -= 13
                if len(b) > 55:
                    c.drawString(rx + 8, yr, b[55:]); yr -= 13
            yr -= 8
    else:
        size = 10.5 if kind == "helv" else 9
        c.setFont(fb, 22); c.drawString(48, H - 60, p["name"]); c.setFont(f, 12); c.drawString(48, H - 80, p["title"])
        c.setFont(f, size); c.drawString(48, H - 96, f'{p["email"]}  {p["phone"]}'); y = H - 130
        c.setFont(fb, 12); c.drawString(48, y, "EXPERIENCE"); y -= 18
        for co, role, dates, bullets in p["jobs"]:
            c.setFont(fb, 11); c.drawString(48, y, f"{role}, {co} ({dates})"); y -= 14; c.setFont(f, size)
            for b in bullets:
                c.drawString(60, y, "* " + b[: (80 if kind == "helv" else 64)]); y -= 13
            y -= 8
        c.setFont(fb, 12); c.drawString(48, y, "EDUCATION"); y -= 16; c.setFont(f, size)
        s, g, yv = p["edu"][0]; c.drawString(48, y, f"{s}, {g}, {yv}"); y -= 22
        c.setFont(fb, 12); c.drawString(48, y, "SKILLS"); y -= 16; c.setFont(f, size); c.drawString(48, y, ", ".join(p["skills"]))
    c.showPage(); c.save()

def nonembedded_cjk(p, path):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))  # Adobe-GB1, NOT embedded
    c = rl_canvas(path); W, H = 612, 792
    c.setFont("STSong-Light", 24); c.drawString(48, H - 64, p["name"]); c.setFont("STSong-Light", 13); c.drawString(48, H - 86, p["title"])
    c.setFont("STSong-Light", 10.5); c.drawString(48, H - 104, f'{p["email"]}   {p["phone"]}   {p["city"]}')
    y = H - 140; c.setFont("STSong-Light", 13); c.drawString(48, y, "工作经历"); y -= 20
    for co, role, dates, bullets in p["jobs"]:
        c.setFont("STSong-Light", 12); c.drawString(48, y, f"{role}，{co}"); c.setFont("STSong-Light", 10.5); c.drawRightString(W - 48, y, dates); y -= 16
        for b in bullets:
            c.drawString(60, y, "• " + b); y -= 14
        y -= 8
    c.setFont("STSong-Light", 13); c.drawString(48, y, "教育背景"); y -= 18; c.setFont("STSong-Light", 10.5)
    s, g, yv = p["edu"][0]; c.drawString(48, y, f"{s}  {g}  {yv}"); y -= 22
    c.setFont("STSong-Light", 13); c.drawString(48, y, "专业技能"); y -= 18; c.setFont("STSong-Light", 10.5); c.drawString(48, y, "  ".join(p["skills"]))
    c.showPage(); c.save()

# ── scans ────────────────────────────────────────────────────────────────────
def make_scan(src_pdf, out_pdf, dpi=150, skew=0.8, gray=False, pages=1):
    from PIL import Image, ImageFilter
    import random
    random.seed(7)
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["pdftoppm", "-r", str(dpi), "-png", str(src_pdf), f"{td}/p"], check=True)
        imgs = []
        for f in sorted(Path(td).glob("p*.png"))[:pages]:
            im = Image.open(f).convert("L" if gray else "RGB")
            im = im.rotate(skew, expand=False, fillcolor=255 if gray else (255, 255, 255)).filter(ImageFilter.GaussianBlur(0.6))
            px = im.load()
            for _ in range(int(im.width * im.height * 0.002)):
                x, y = random.randrange(im.width), random.randrange(im.height)
                v = random.randrange(150, 230)
                px[x, y] = v if gray else (v, v, v)
            imgs.append(im)
        imgs[0].save(out_pdf, "PDF", resolution=dpi, save_all=True, append_images=imgs[1:], quality=70)

# ── assemble ─────────────────────────────────────────────────────────────────
def main():
    for f in CORPUS.glob("*.pdf"):
        f.unlink()
    reg_ttf()
    side = [("left", [0.0, 0.40]), ("right", [0.28, 1.0])]
    tmp = Path(tempfile.mkdtemp())

    def word(id_, p, kind, zh=False, pages=1, anchors=None):
        dx = tmp / f"{id_}.docx"; build_docx(p, kind, dx, zh=zh); docx_to_pdf(dx, CORPUS)
        add(f"{id_}.pdf", "word", "zh" if zh else "en", pages, core_phrases(p), anchors)

    p0, p1, p2, p3 = EN
    word("word-single-column", p0, "single", anchors=[dict(text=p0["name"], page=1, band=[0, 0.5])])
    word("word-sidebar-table", p1, "sidebar", anchors=[dict(text=p1["skills"][0], page=1, band=[0, 0.36]), dict(text=p1["jobs"][0][3][0][:16], page=1, band=[0.25, 1])])
    word("word-multipage-header-footer", p2, "multipage", pages=2, anchors=[dict(text="references available", page=1, band=[0, 1])])
    word("word-skills-table", p3, "table", anchors=[dict(text="Skill", page=1, band=[0, 0.5])])
    word("word-zh-single-column", ZH[0], "single", zh=True)
    # bilingual: English resume with Chinese contact block
    bi = dict(EN[2]); bi["summary"] = "全栈工程师，负责支付系统重构。 " + EN[2]["summary"]
    word("word-bilingual-zh-en", bi, "single", zh=True)
    manifest[-1]["lang"] = "zh+en"; manifest[-1]["expectText"] = [EN[2]["name"], "全栈工程师", EN[2]["jobs"][0][0], EN[2]["skills"][0]]

    def gdoc(id_, p, kind, zh=False, pages=1, anchors=None):
        chromium_pdf(html_resume(p, kind, zh), CORPUS / f"{id_}.pdf")
        add(f"{id_}.pdf", "gdocs", "zh" if zh else "en", pages, core_phrases(p), anchors)

    gdoc("gdocs-single-links", p1, "links")
    gdoc("gdocs-two-column-grid", p2, "twocol", anchors=[dict(text=p2["skills"][0], page=1, band=[0, 0.36]), dict(text=p2["jobs"][0][3][0][:16], page=1, band=[0.25, 1])])
    gdoc("gdocs-tables", p3, "table")
    gdoc("gdocs-multipage", p0, "multipage", pages=2)
    gdoc("gdocs-zh-two-column", ZH[1], "twocol", zh=True)
    gdoc("gdocs-zh-table", ZH[0], "table", zh=True)

    def rl(id_, fn, p, family, lang="en", anchors=None):
        fn(p, CORPUS / f"{id_}.pdf")
        add(f"{id_}.pdf", family, lang, 1, core_phrases(p), anchors)

    rl("canva-style-sidebar", canva_sidebar, p0, "canva", anchors=[dict(text=p0["skills"][0], page=1, band=[0, 0.34]), dict(text=p0["jobs"][0][1], page=1, band=[0.34, 1])])
    rl("canva-style-banner", canva_banner, p1, "canva")
    rl("canva-style-timeline", canva_timeline, p2, "canva")
    rl("canva-style-word-runs", canva_grid, p3, "canva")

    for kind, p in (("helv", p0), ("times", p1), ("courier", p2)):
        nonembedded(p, CORPUS / f"nonembedded-{kind}.pdf", kind)
        add(f"nonembedded-{kind}.pdf", "nonembed", "en", 1, core_phrases(p),
            [dict(text=p["skills"][0], page=1, band=[0, 0.4]), dict(text=p["jobs"][0][1], page=1, band=[0.38, 1])] if kind == "times" else [])
    nonembedded_cjk(ZH[0], CORPUS / "nonembedded-zh-stsong.pdf")
    add("nonembedded-zh-stsong.pdf", "nonembed", "zh", 1, core_phrases(ZH[0]),
        note="Adobe-GB1 CID font, not embedded. Headless Node has no system CJK font to paint it with, so the pixel check is skipped for this one document; the text layer (CMap decode) is still verified. In a browser the system CJK font paints it.")
    manifest[-1]["render"] = "text-only"

    make_scan(CORPUS / "canva-style-banner.pdf", CORPUS / "scan-color-skewed.pdf", dpi=150, skew=0.8)
    add("scan-color-skewed.pdf", "scan", "en", 1, [], scan=True, note="image-only page; no text layer by design")
    make_scan(CORPUS / "word-multipage-header-footer.pdf", CORPUS / "scan-gray-two-page.pdf", dpi=120, skew=-0.6, gray=True, pages=2)
    add("scan-gray-two-page.pdf", "scan", "en", 2, [], scan=True, note="image-only, 2 pages")

    # page counts come from poppler, an implementation independent of the viewer under test
    for m in manifest:
        out = subprocess.run(["pdfinfo", str(CORPUS / m["file"])], capture_output=True, text=True, check=True).stdout
        m["pages"] = int(next(l for l in out.splitlines() if l.startswith("Pages:")).split()[1])

    # golden reference rasters: poppler at 72 dpi (= PDF.js scale 1), one gray PNG per page. The gate compares
    # PDF.js's own paint against these, so "the viewer drew something different" is measured, not assumed.
    gold = HERE / "golden"
    shutil.rmtree(gold, ignore_errors=True); gold.mkdir()
    for m in manifest:
        if m["scan"] or m.get("render") == "text-only":
            continue
        for n in range(1, m["pages"] + 1):
            subprocess.run(["pdftoppm", "-r", "72", "-gray", "-png", "-f", str(n), "-l", str(n), "-singlefile",
                            str(CORPUS / m["file"]), str(gold / f"{m['id']}-{n}")], check=True)
        m["golden"] = True

    (HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"{len(manifest)} documents -> {CORPUS}")

if __name__ == "__main__":
    main()
