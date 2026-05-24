require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// In-memory store for free-tier usage tracking (keyed by IP)
// In production, swap this for Redis or a database
const usageStore = new Map();
// In-memory store for active subscriptions (email -> customerId)
const subscribers = new Map();

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Raw body needed for Stripe webhook verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Rate limiting ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down.' }
});
app.use('/api/', apiLimiter);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTodayKey(ip) {
  const today = new Date().toISOString().slice(0, 10);
  return `${ip}_${today}`;
}

function hasFreeTierLeft(ip) {
  const key = getTodayKey(ip);
  return (usageStore.get(key) || 0) < 1;
}

function consumeFreeTier(ip) {
  const key = getTodayKey(ip);
  usageStore.set(key, (usageStore.get(key) || 0) + 1);
}

function isSubscriber(email) {
  return email && subscribers.has(email.toLowerCase());
}

// ─── API: Check usage status ──────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const ip = req.ip;
  const email = req.query.email || '';
  res.json({
    freeUsesLeft: hasFreeTierLeft(ip) ? 1 : 0,
    isSubscriber: isSubscriber(email)
  });
});

// ─── API: Tailor resume ───────────────────────────────────────────────────────
app.post('/api/tailor', async (req, res) => {
  const { resume, jobPosting, mode, email } = req.body;

  if (!resume || !jobPosting) {
    return res.status(400).json({ error: 'Resume and job posting are required.' });
  }
  if (!['resume', 'cover_letter', 'both'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode.' });
  }

  const ip = req.ip;
  const subscribed = isSubscriber(email);

  if (!subscribed) {
    if (!hasFreeTierLeft(ip)) {
      return res.status(402).json({
        error: 'free_limit_reached',
        message: 'You have used your free daily tailoring. Upgrade to Pro for unlimited access.'
      });
    }
    consumeFreeTier(ip);
  }

  try {
    const systemPrompt = `You are an expert career coach and professional resume writer with 15+ years of experience helping candidates land jobs at top companies. You tailor resumes and write compelling cover letters by carefully matching the candidate's experience to the job requirements using relevant keywords and framing.`;

    let userPrompt = '';

    if (mode === 'resume' || mode === 'both') {
      userPrompt += `## Task: Tailor the resume below to the job posting.

**Rules:**
- Keep the same resume structure and factual experience — never fabricate anything
- Reword bullet points to mirror the language and keywords in the job posting
- Prioritize and reorder bullet points so the most relevant experience appears first
- Adjust the summary/objective section (if present) to target this specific role
- Output the full tailored resume in clean markdown

## Candidate Resume:
${resume}

## Job Posting:
${jobPosting}

---
**OUTPUT: Tailored Resume (markdown)**
`;
    }

    if (mode === 'cover_letter' || mode === 'both') {
      if (mode === 'both') userPrompt += '\n\n---\n\n';
      userPrompt += `## Task: Write a compelling cover letter for this job.

**Rules:**
- 3–4 paragraphs, professional but personable tone
- Opening: hook with a specific reason why this company/role excites you
- Middle: connect 2–3 of the candidate's strongest achievements to the job's key needs
- Closing: confident call to action
- Do NOT use generic filler phrases like "I am writing to express my interest"
- Use keywords from the job posting naturally

## Candidate Resume:
${resume}

## Job Posting:
${jobPosting}

---
**OUTPUT: Cover Letter**
`;
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    res.json({ result: message.content[0].text });
  } catch (err) {
    console.error('Claude API error:', err);
    res.status(500).json({ error: 'AI processing failed. Please try again.' });
  }
});

// ─── API: Create Stripe checkout session ──────────────────────────────────────
app.post('/api/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${req.headers.origin || 'http://localhost:3000'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'http://localhost:3000'}/app.html`,
      metadata: { email }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// ─── Stripe webhook: activate subscription ────────────────────────────────────
app.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = (session.metadata?.email || session.customer_email || '').toLowerCase();
    if (email) {
      subscribers.set(email, session.customer);
      console.log(`New subscriber: ${email}`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    // Remove subscriber when they cancel
    const customerId = event.data.object.customer;
    for (const [email, id] of subscribers.entries()) {
      if (id === customerId) {
        subscribers.delete(email);
        console.log(`Removed subscriber: ${email}`);
        break;
      }
    }
  }

  res.json({ received: true });
});

// ─── In-memory forum posts ────────────────────────────────────────────────────
const forumPosts = [
  { id: 1, author: 'Sarah M.', role: 'Software Engineer', time: '2 hours ago', text: 'Just accepted an offer at a Fortune 500! ResumeTailor helped me tailor 30+ applications. Happy to answer questions about the process.', replies: [], likes: 14 },
  { id: 2, author: 'James R.', role: 'Marketing Manager', time: '5 hours ago', text: 'Salary negotiation tip: always get the offer in writing before negotiating. They said my ask was "too high" verbally but came back with 8% more once I sent a counter via email. Never negotiate on the phone!', replies: [], likes: 22 },
  { id: 3, author: 'Priya K.', role: 'Product Designer', time: '1 day ago', text: 'For anyone in tech design — portfolio matters MORE than your resume. But a tailored resume got me the interview so I could show my portfolio. Both matter!', replies: [], likes: 9 },
];
let nextPostId = 4;

// ─── API: Forum ───────────────────────────────────────────────────────────────
app.get('/api/forum', (req, res) => {
  res.json(forumPosts.slice().reverse());
});

app.post('/api/forum', (req, res) => {
  const { author, role, text } = req.body;
  if (!text || text.trim().length < 5) return res.status(400).json({ error: 'Post too short.' });
  const post = {
    id: nextPostId++,
    author: author || 'Anonymous',
    role: role || 'Professional',
    time: 'just now',
    text: text.trim(),
    replies: [],
    likes: 0
  };
  forumPosts.push(post);
  res.json(post);
});

app.post('/api/forum/:id/like', (req, res) => {
  const post = forumPosts.find(p => p.id === parseInt(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found.' });
  post.likes++;
  res.json({ likes: post.likes });
});

app.post('/api/forum/:id/reply', (req, res) => {
  const post = forumPosts.find(p => p.id === parseInt(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found.' });
  const { author, text } = req.body;
  if (!text || text.trim().length < 2) return res.status(400).json({ error: 'Reply too short.' });
  const reply = { author: author || 'Anonymous', text: text.trim(), time: 'just now' };
  post.replies.push(reply);
  res.json(reply);
});

// ─── API: Career check-in ─────────────────────────────────────────────────────
const checkIns = new Map(); // email -> { lastCheckIn, goals }

app.get('/api/checkin', (req, res) => {
  const email = (req.query.email || '').toLowerCase();
  const data = checkIns.get(email) || { lastCheckIn: null, goals: '', nextPrompt: getCheckInPrompt() };
  res.json(data);
});

app.post('/api/checkin', (req, res) => {
  const { email, goals, currentRole, targetRole } = req.body;
  const key = (email || '').toLowerCase();
  checkIns.set(key, {
    lastCheckIn: new Date().toISOString(),
    goals: goals || '',
    currentRole: currentRole || '',
    targetRole: targetRole || '',
    nextPrompt: getCheckInPrompt()
  });
  res.json({ success: true });
});

function getCheckInPrompt() {
  const prompts = [
    "What new skills have you developed in the last 3 months?",
    "Are you being paid what you're worth? When did you last benchmark your salary?",
    "Have you updated your resume to reflect your latest accomplishments?",
    "What's your next career move? Is it time to aim higher?",
    "Have you connected with 3 new people in your industry this quarter?",
    "What would make your work more fulfilling? Is it time for a change?"
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

// ─── API: Contact / Help form ─────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  // If no email service configured, log it and return success
  // To enable real email: set RESEND_API_KEY in Railway env vars (free at resend.com)
  const resendKey = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL || 'marvinperson@icloud.com';

  if (resendKey) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`
        },
        body: JSON.stringify({
          from: 'ResumeTailor Support <support@resumetailored.com>',
          to: ownerEmail,
          reply_to: email,
          subject: `[ResumeTailor Support] ${subject || 'New message from ' + name}`,
          html: `
            <h2>New Support Message</h2>
            <p><strong>From:</strong> ${name} (${email})</p>
            <p><strong>Subject:</strong> ${subject || 'No subject'}</p>
            <hr />
            <p>${message.replace(/\n/g, '<br>')}</p>
            <hr />
            <p style="color:#888;font-size:12px;">Sent from ResumeTailor AI Help form</p>
          `
        })
      });
      if (!emailRes.ok) throw new Error('Resend error');
    } catch (err) {
      console.error('Email send error:', err);
      // Still return success to user — don't block them
    }
  } else {
    // Log to console until email is configured
    console.log(`[SUPPORT MESSAGE] From: ${name} <${email}> | Subject: ${subject} | Message: ${message}`);
  }

  res.json({ success: true });
});

// ─── Serve pages ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ResumeTailor running on http://localhost:${PORT}`));
