# Skill Anatomy

## Directory layout

```
<skill-name>/
├── SKILL.md            # required — frontmatter + instructions
├── references/         # optional — markdown loaded on demand
│   └── *.md
├── scripts/            # optional — executable helpers
│   └── *.py | *.sh | *.js
└── assets/             # optional — templates, images, boilerplate
    └── *
```

Only `SKILL.md` is required. Add the other directories only when something lives in them.

## Frontmatter fields

```yaml
---
name: my-skill                 # required. lowercase, hyphens, ≤64 chars.
                               #   A repo may prefix (e.g. "ckm:my-skill").
description: >                 # required. ≤1024 chars. Third person.
  What the skill does AND when to use it, with trigger words.
argument-hint: "[input]"       # optional. Shown in slash-command UI.
license: MIT                   # optional.
metadata:                      # optional. Free-form.
  author: your-name
  version: "1.0.0"
allowed-tools: Read, Grep      # optional. Restrict tools when invoked.
---
```

Required: `name`, `description`. Everything else is optional.

## Body structure

The body is markdown, loaded only after the skill activates. A reliable shape:

```markdown
# Skill Name

One or two sentences: what it does and, importantly, what it does NOT do
(scope boundaries prevent over-triggering).

## When to Use
- Bullet list of concrete situations / user phrasings.

## Workflow
### Step 1: …
### Step 2: …

## References
- `references/foo.md` — what's in it and when to read it.
```

Guidelines:
- Keep the body under ~500 lines. Push detail to `references/`.
- Use imperative, numbered steps — it's a procedure for Claude to follow.
- Point to bundled files by **relative path**; describe when to open each.
- State scope limits explicitly so the skill doesn't fire on adjacent tasks.

## Annotated example

```
pdf-tools/
├── SKILL.md
├── references/
│   └── pdflib-api.md        # large API surface, loaded only when filling forms
└── scripts/
    └── extract_text.py      # deterministic helper run instead of re-deriving code
```

```yaml
---
name: pdf-tools
description: "Extract text and tables from PDFs and fill PDF form fields.
  Use when the user wants to read, parse, or populate PDF documents."
---
```

Body sketch:

```markdown
# PDF Tools
Read and fill PDFs. Does not convert other formats to PDF.

## When to Use
- "Extract the text/tables from this PDF"
- "Fill out this PDF form with these values"

## Workflow
### Step 1: Extract
Run `python3 scripts/extract_text.py <file>`.
### Step 2: Fill forms
For form filling, load `references/pdflib-api.md` for the field API, then …
```

The reference file is only read when the user actually fills a form — that's progressive disclosure working as intended.
