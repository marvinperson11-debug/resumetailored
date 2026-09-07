/**
 * Static thumbnail previews for the template picker — a faithful port of the
 * old site's `makeStaticPreview` (public/app.html). Sample content, ~140px
 * tall cards, one branch per layout. Used only for the gallery grid; the real
 * document render lives in `renderAIOutput` (resume-templates.ts).
 */
import type { Template } from "./resume-templates";

export function makeStaticPreview(tpl: Template): string {
  const { p, a, l } = tpl.c;
  const font = tpl.serif ? "Georgia,serif" : "'Inter',sans-serif";
  switch (tpl.layout) {
    case "rClassic":
      return `<div style="background:#fff;padding:10px;font-family:${font};height:140px;overflow:hidden;">
        <div style="text-align:center;border-bottom:1.5px solid ${p};padding-bottom:5px;margin-bottom:5px;">
          <div style="font-size:9.5px;font-weight:700;letter-spacing:2px;color:${p};text-transform:uppercase;">ALEX JOHNSON</div>
          <div style="font-size:5.5px;color:#475569;margin-top:2px;">alex@email.com · New York, NY</div>
        </div>
        <div style="font-size:6px;font-weight:700;text-transform:uppercase;color:${p};border-bottom:1px solid ${p};padding-bottom:1px;margin-bottom:3px;letter-spacing:1px;">Experience</div>
        <div style="font-size:6.5px;font-weight:700;color:#0f172a;margin-bottom:1px;">Sr. Marketing Manager · TechCorp</div>
        <div style="font-size:5.5px;color:#475569;line-height:1.4;margin-bottom:3px;">• Grew pipeline 34% YoY · $2.1M revenue</div>
        <div style="font-size:6px;font-weight:700;text-transform:uppercase;color:${p};border-bottom:1px solid ${p};padding-bottom:1px;margin-bottom:2px;letter-spacing:1px;">Skills</div>
        <div style="font-size:5.5px;color:#475569;">Python · SQL · Tableau · Salesforce</div>
      </div>`;
    case "rExecutive":
      return `<div style="background:#fff;padding:10px;font-family:${font};height:140px;overflow:hidden;">
        <div style="border-left:3px solid ${p};padding-left:7px;margin-bottom:7px;">
          <div style="font-size:9px;font-weight:800;color:${p};text-transform:uppercase;letter-spacing:1px;">MICHAEL CHEN</div>
          <div style="font-size:5.5px;color:#64748b;margin-top:2px;">VP Engineering · 15+ Years</div>
        </div>
        <div style="font-size:6px;font-weight:700;color:${a};text-transform:uppercase;letter-spacing:1px;border-left:2px solid ${a};padding-left:5px;margin-bottom:3px;">Experience</div>
        <div style="font-size:6px;color:#1e293b;padding-left:7px;">CTO · Fortune 500 · 2019–Present</div>
        <div style="font-size:5.5px;color:#64748b;padding-left:7px;margin-bottom:3px;">Drove 3× revenue growth, 50+ engineers</div>
        <div style="font-size:6px;font-weight:700;color:${a};text-transform:uppercase;letter-spacing:1px;border-left:2px solid ${a};padding-left:5px;margin-bottom:2px;">Skills</div>
        <div style="font-size:5.5px;color:#64748b;padding-left:7px;">Cloud · ML · DevOps · Leadership</div>
      </div>`;
    case "rModern":
      return `<div style="background:#fff;font-family:${font};height:140px;overflow:hidden;">
        <div style="background:${p};padding:10px 10px 8px;">
          <div style="font-size:9.5px;font-weight:800;color:#fff;letter-spacing:.5px;">SARAH CHEN</div>
          <div style="font-size:5.5px;color:${l};margin-top:2px;opacity:0.9;">sarah@email.com · San Francisco, CA</div>
        </div>
        <div style="padding:7px 10px;">
          <div style="font-size:6px;font-weight:800;color:${a};text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Experience</div>
          <div style="font-size:6.5px;font-weight:700;color:#111827;">Software Engineer · Stripe</div>
          <div style="font-size:5.5px;color:#4b5563;line-height:1.4;margin-bottom:3px;">• API handling 50M+ transactions<br/>• Reduced latency 42%</div>
          <div style="font-size:6px;font-weight:800;color:${a};text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Skills</div>
          <div style="font-size:5.5px;color:#4b5563;">TypeScript · React · Node.js · AWS</div>
        </div>
      </div>`;
    case "rSidebar":
      return `<div style="background:#fff;display:flex;font-family:${font};height:140px;overflow:hidden;">
        <div style="background:${p};width:46px;padding:8px 6px;flex-shrink:0;">
          <div style="font-size:6px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px;line-height:1.2;">ALEX J.</div>
          <div style="font-size:5px;color:${l};opacity:0.9;margin-bottom:4px;">NYC</div>
          <div style="font-size:5px;font-weight:700;color:${a};text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Skills</div>
          <div style="font-size:5px;color:${l};opacity:0.9;line-height:1.5;">Python<br/>SQL<br/>React</div>
        </div>
        <div style="padding:10px 8px;flex:1;">
          <div style="font-size:6px;font-weight:700;color:${p};text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid ${p};padding-bottom:1px;margin-bottom:3px;">Experience</div>
          <div style="font-size:6px;font-weight:700;color:#1e293b;">Sr. Engineer · TechCorp</div>
          <div style="font-size:5px;color:#64748b;line-height:1.4;margin-top:1px;">• Built core API, 50M+ req/day<br/>• Cut infra costs 40%</div>
        </div>
      </div>`;
    case "rMinimal":
      return `<div style="background:#fafafa;padding:12px;font-family:${font};height:140px;overflow:hidden;">
        <div style="margin-bottom:6px;">
          <div style="font-size:9px;font-weight:300;letter-spacing:3px;color:#111827;text-transform:uppercase;">JESSICA PARK</div>
          <div style="font-size:5.5px;color:#6b7280;margin-top:2px;">Product Designer · jessica@email.com</div>
          <div style="width:100%;height:0.5px;background:${p};margin-top:5px;"></div>
        </div>
        <div style="font-size:6px;font-weight:500;color:${p};text-transform:uppercase;letter-spacing:2px;margin-bottom:3px;">Work</div>
        <div style="font-size:6px;color:#374151;margin-bottom:1px;">Lead Designer · Figma</div>
        <div style="font-size:5.5px;color:#9ca3af;margin-bottom:3px;">Redesigned core editor, +22% DAU</div>
        <div style="font-size:6px;font-weight:500;color:${p};text-transform:uppercase;letter-spacing:2px;margin-bottom:2px;">Tools</div>
        <div style="font-size:5.5px;color:#9ca3af;">Figma · Principle · Lottie · Swift UI</div>
      </div>`;
    case "cFormal":
      return `<div style="background:#fff;padding:12px;font-family:${font};height:140px;overflow:hidden;">
        <div style="border-bottom:1.5px solid ${p};margin-bottom:7px;padding-bottom:5px;">
          <div style="font-size:9px;font-weight:700;color:${p};letter-spacing:1px;text-transform:uppercase;">ALEX JOHNSON</div>
          <div style="font-size:5.5px;color:#475569;margin-top:1px;">alex@email.com · New York, NY</div>
        </div>
        <div style="font-size:5.5px;color:#374151;line-height:1.55;">Dear Hiring Manager,</div>
        <div style="font-size:5.5px;color:#374151;line-height:1.55;margin-top:3px;">I am excited to apply. My background in marketing and data analysis aligns closely with your needs...</div>
        <div style="font-size:5.5px;color:#374151;line-height:1.55;margin-top:4px;">Sincerely,<br/>Alex Johnson</div>
      </div>`;
    case "cBold":
      return `<div style="background:#fff;font-family:${font};height:140px;overflow:hidden;">
        <div style="background:${p};padding:10px 10px 8px;">
          <div style="font-size:9px;font-weight:800;color:#fff;letter-spacing:.5px;">ALEX JOHNSON</div>
          <div style="font-size:5.5px;color:${a};margin-top:2px;">Marketing Director</div>
        </div>
        <div style="padding:7px 10px;">
          <div style="font-size:5.5px;color:#374151;line-height:1.55;">Dear Hiring Manager,</div>
          <div style="font-size:5.5px;color:#374151;line-height:1.55;margin-top:3px;">I'm thrilled to apply. My track record in pipeline growth and team leadership makes me a strong fit...</div>
        </div>
      </div>`;
    case "cBoxed":
      return `<div style="background:#fff;padding:10px;font-family:${font};height:140px;overflow:hidden;">
        <div style="border:1.5px solid ${p};padding:6px 8px;margin-bottom:7px;">
          <div style="font-size:9px;font-weight:700;color:${p};letter-spacing:1px;text-transform:uppercase;">ALEX JOHNSON</div>
          <div style="font-size:5.5px;color:#475569;margin-top:1px;">alex@email.com · New York, NY</div>
        </div>
        <div style="font-size:5.5px;color:#374151;line-height:1.55;">Dear Hiring Manager,<br/>I am writing to express my strong interest in this position. My experience in driving results...</div>
      </div>`;
    case "cSplit":
      return `<div style="background:#fff;font-family:${font};height:140px;overflow:hidden;">
        <div style="display:flex;background:${p};">
          <div style="padding:10px;flex:1;">
            <div style="font-size:9px;font-weight:800;color:#fff;letter-spacing:.5px;">ALEX JOHNSON</div>
            <div style="font-size:5.5px;color:${l};margin-top:2px;opacity:0.9;">Marketing Director</div>
          </div>
          <div style="background:${a};width:6px;"></div>
        </div>
        <div style="padding:7px 10px;font-size:5.5px;color:#374151;line-height:1.55;">
          Dear Hiring Manager,<br/>I'm excited to bring my expertise in pipeline growth and team leadership to your organization...
        </div>
      </div>`;
    case "cClean":
      return `<div style="background:${l};padding:12px;font-family:${font};height:140px;overflow:hidden;">
        <div style="margin-bottom:8px;">
          <div style="font-size:9px;font-weight:700;color:${p};">Alex Johnson</div>
          <div style="font-size:5.5px;color:${a};margin-top:1px;">alex@email.com · New York, NY</div>
          <div style="width:24px;height:2px;background:${a};margin-top:4px;"></div>
        </div>
        <div style="font-size:5.5px;color:${p};line-height:1.6;">Dear Hiring Manager,<br/>I am writing to express my enthusiasm for this role. My background in marketing and data analysis...</div>
      </div>`;
    case "rTwoCol":
      return `<div style="background:#fff;display:flex;font-family:${font};height:140px;overflow:hidden;">
        <div style="width:46px;padding:8px 6px;border-right:1.5px solid ${a}40;flex-shrink:0;">
          <div style="font-size:6px;font-weight:800;color:${p};margin-bottom:4px;line-height:1.2;">ALEX J.</div>
          <div style="font-size:5px;color:#666;line-height:1.5;margin-bottom:3px;">NYC<br/>alex@co</div>
          <div style="font-size:5px;font-weight:700;color:${p};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid ${a}50;padding-bottom:1px;margin-bottom:2px;">Skills</div>
          <div style="font-size:5px;color:#555;line-height:1.5;">Python<br/>SQL<br/>React</div>
        </div>
        <div style="padding:8px 7px;flex:1;">
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;"><div style="width:10px;height:1.5px;background:${a};border-radius:1px;"></div><span style="font-size:5.5px;font-weight:700;color:${p};text-transform:uppercase;letter-spacing:1px;">Experience</span></div>
          <div style="font-size:6px;font-weight:700;color:#1e293b;">Sr. Engineer · TechCorp</div>
          <div style="font-size:5px;color:#64748b;line-height:1.4;margin-top:1px;">• Built core API, 50M+ req/day<br/>• Cut infra costs 40%</div>
        </div>
      </div>`;
    case "rBanner":
      return `<div style="background:#fff;padding:0;font-family:${font};height:140px;overflow:hidden;">
        <div style="border-left:4px solid ${p};padding:10px 10px 8px;">
          <div style="font-size:9px;font-weight:800;color:${p};letter-spacing:-0.3px;">ALEX JOHNSON</div>
          <div style="font-size:5.5px;color:#666;margin-top:2px;">alex@email.com · New York, NY</div>
          <div style="height:1.5px;background:linear-gradient(to right,${p},${a},transparent);margin-top:5px;"></div>
        </div>
        <div style="padding:6px 10px;">
          <div style="display:inline-block;background:${p};color:#fff;font-size:5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:2px 6px;border-radius:2px;margin-bottom:3px;">Experience</div>
          <div style="font-size:6px;font-weight:700;color:#1e293b;">Sr. Engineer · TechCorp</div>
          <div style="font-size:5.5px;color:#64748b;line-height:1.4;">• Built APIs, 50M+ req/day · Cut costs 40%</div>
        </div>
      </div>`;
    case "cModern":
      return `<div style="background:#fff;font-family:${font};height:140px;overflow:hidden;">
        <div style="background:${p};padding:10px 10px 8px;">
          <div style="font-size:9px;font-weight:800;color:#fff;letter-spacing:.5px;">ALEX JOHNSON</div>
          <div style="font-size:5.5px;color:rgba(255,255,255,.75);margin-top:2px;">alex@email.com · New York, NY</div>
        </div>
        <div style="padding:7px 10px;">
          <div style="font-size:5.5px;color:#374151;line-height:1.55;">Dear Hiring Manager,</div>
          <div style="font-size:5.5px;color:#374151;line-height:1.55;margin-top:3px;">I am thrilled to apply. My expertise in marketing and leadership aligns with your needs...</div>
        </div>
      </div>`;
    default:
      return `<div style="background:#f3f4f6;height:140px;"></div>`;
  }
}
