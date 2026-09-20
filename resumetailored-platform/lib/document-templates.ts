/**
 * Starting points for the Document Creator. Plain, editable HTML (headings,
 * paragraphs, lists) with human-readable bracket placeholders the employer fills
 * in before sending — NOT merge tokens. This replaces the old Templates tab:
 * pick one, edit the text, then Send for signature. Pure data, no DB/network.
 *
 * The signature block is appended automatically at send time, so these bodies
 * do not include a signature line.
 */
export interface DocumentTemplate {
  key: string;
  name: string;
  body: string;
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    key: "offer",
    name: "Offer letter",
    body: `<h1>Offer of Employment</h1>
<p>Dear [Candidate Name],</p>
<p>We are delighted to offer you the position of <b>[Position]</b> at [Company Name]. We were impressed by your background and believe you will be a great addition to our team.</p>
<h2>The details</h2>
<ul>
<li><b>Position:</b> [Position]</li>
<li><b>Start date:</b> [Start Date]</li>
<li><b>Compensation:</b> [Salary] per year</li>
<li><b>Reports to:</b> [Manager]</li>
</ul>
<p>This offer is contingent on the standard background and eligibility checks. Employment is at-will and may be terminated by either party at any time.</p>
<p>To accept, please sign below. We look forward to welcoming you aboard.</p>
<p>Warm regards,<br>[Your Name]<br>[Company Name]</p>`,
  },
  {
    key: "agreement",
    name: "Employment agreement",
    body: `<h1>Employment Agreement</h1>
<p>This Employment Agreement is entered into between <b>[Company Name]</b> ("the Company") and <b>[Employee Name]</b> ("the Employee").</p>
<h2>1. Position and duties</h2>
<p>The Employee will serve as [Position] and will perform the duties reasonably associated with that role.</p>
<h2>2. Compensation</h2>
<p>The Company will pay the Employee [Salary] per year, payable in accordance with the Company's standard payroll schedule.</p>
<h2>3. Term</h2>
<p>Employment begins on [Start Date] and continues on an at-will basis unless terminated as provided herein.</p>
<h2>4. Confidentiality</h2>
<p>The Employee agrees to keep the Company's confidential information private during and after employment.</p>
<p>By signing below, both parties agree to the terms above.</p>`,
  },
  {
    key: "nda",
    name: "Non-disclosure agreement",
    body: `<h1>Non-Disclosure Agreement</h1>
<p>This Non-Disclosure Agreement ("Agreement") is made between <b>[Company Name]</b> and <b>[Recipient Name]</b> ("Recipient").</p>
<h2>1. Confidential information</h2>
<p>"Confidential Information" means any non-public information disclosed by the Company, including business plans, customer data, and technical materials.</p>
<h2>2. Obligations</h2>
<ul>
<li>Keep the Confidential Information strictly confidential.</li>
<li>Use it only for the agreed purpose.</li>
<li>Do not disclose it to any third party without written consent.</li>
</ul>
<h2>3. Term</h2>
<p>These obligations remain in effect for [Number] years from the date of signature.</p>
<p>By signing below, the Recipient agrees to the terms of this Agreement.</p>`,
  },
  {
    key: "writeup",
    name: "Employee write-up",
    body: `<h1>Employee Write-Up / Corrective Action</h1>
<p><b>Employee:</b> [Employee Name]<br>
<b>Date of incident:</b> [Date]<br>
<b>Policy violated:</b> [Policy]</p>
<h2>Description of incident</h2>
<p>[Describe what happened.]</p>
<h2>Corrective action</h2>
<p>[Expected change and timeline.]</p>
<h2>Additional notes</h2>
<p>[Optional.]</p>
<p>By signing below, the employee acknowledges receipt of this write-up. A signature indicates receipt, not necessarily agreement.</p>`,
  },
];

export function getDocumentTemplate(key: string): DocumentTemplate | null {
  return DOCUMENT_TEMPLATES.find((t) => t.key === key) || null;
}
