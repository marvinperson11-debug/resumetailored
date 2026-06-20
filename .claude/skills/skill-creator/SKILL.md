---
name: ckm:skill-creator
description: "Create, scaffold, and refine Claude Code Agent Skills. Use when the user wants to build a new skill, author a SKILL.md, package an existing skill, fix a skill that isn't triggering, or improve a skill's description and structure. Covers frontmatter, progressive disclosure (references/scripts/assets), trigger-word descriptions, and validation."
argument-hint: "[skill name or what the skill should do]"
license: MIT
metadata:
  author: claudekit
  version: "1.0.0"
---

# Skill Creator

Author new Agent Skills and improve existing ones. A skill is a directory containing a `SKILL.md` file (required) plus optional bundled `references/`, `scripts/`, and `assets/`. This skill handles skill authoring only — it does not write application features, only the skill packages that teach Claude how to do things.

## When to Use

- "Create a skill that…" / "Make a new skill for…"
- "Why isn't my skill triggering?" (description/metadata debugging)
- "Package this workflow into a skill"
- "Improve / review this SKILL.md"
- Scaffolding a skill directory with the right structure

## Core Mental Model

A skill is **progressive disclosure for Claude**. Three levels:

1. **Metadata (`name` + `description`)** — always loaded into context. This is how Claude decides whether the skill is relevant. Must be tight and trigger-rich.
2. **`SKILL.md` body** — loaded only when the skill activates. The procedure/instructions. Keep under ~500 lines.
3. **Bundled files (`references/`, `scripts/`, `assets/`)** — loaded on demand, only when the body points to them. Put heavy detail, large tables, and reusable code here.

The whole point: keep level-1 small so it's cheap, keep level-2 focused, and push everything bulky to level-3.

## Workflow

### Step 1: Understand the skill's purpose

Clarify (ask via AskUserQuestion only if genuinely ambiguous):
- What task does the skill help with? What triggers it?
- One-shot procedure, or does it need reference docs / executable scripts?
- A good name (lowercase, hyphenated, e.g. `pdf-form-filler`).

### Step 2: Scaffold

Run the init script to create the directory and a starter `SKILL.md`:

```bash
python3 .claude/skills/skill-creator/scripts/init_skill.py <skill-name> \
  --path .claude/skills
```

This creates `.claude/skills/<skill-name>/SKILL.md` with valid frontmatter and the standard subdirectories. Match the `name:` prefix convention used by sibling skills in the repo (here: `ckm:`).

### Step 3: Write the frontmatter

The `description` is the single most important field — it's the only thing Claude reads when deciding to use the skill. See `references/best-practices.md`. Rules:
- Write in **third person**, describing what the skill does AND when to use it.
- Front-load concrete **trigger words** the user is likely to say.
- Be specific. "Helps with files" is useless; "Extract text and tables from PDFs, fill PDF forms" triggers correctly.

### Step 4: Write the body

Keep `SKILL.md` focused and skimmable. Recommended sections: a one-line purpose, "When to Use", and a numbered "Workflow". Reference bundled files by relative path rather than inlining large content. See `references/skill-anatomy.md` for the full structure and examples.

### Step 5: Add bundled resources (only if needed)

- `references/` — markdown loaded on demand (API specs, large tables, detailed guides).
- `scripts/` — executable helpers Claude runs instead of regenerating code each time.
- `assets/` — templates, boilerplate, images used in output.

Don't create empty directories or speculative files. Add a resource only when the body actually points to it.

### Step 6: Validate

```bash
python3 .claude/skills/skill-creator/scripts/validate_skill.py .claude/skills/<skill-name>
```

Checks that `SKILL.md` exists, frontmatter parses, `name`/`description` are present and within length limits, and that referenced files exist.

## Key Constraints

- `name`: lowercase letters, numbers, hyphens (plus any repo prefix like `ckm:`); ≤ 64 chars.
- `description`: ≤ 1024 chars; third person; include triggers.
- One skill = one capability. If it sprawls, split it.
- Reference files by relative path; never assume absolute paths.

## References

- `references/skill-anatomy.md` — directory layout, frontmatter fields, body structure, full annotated example.
- `references/best-practices.md` — writing high-signal descriptions, progressive disclosure, common mistakes, debugging non-triggering skills.
