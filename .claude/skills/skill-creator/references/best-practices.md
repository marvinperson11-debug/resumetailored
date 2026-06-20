# Skill Authoring Best Practices

## The description is everything

Claude sees only `name` + `description` when deciding whether to activate a skill. A perfect body is worthless if the description never matches. Optimize the description first.

### Write in third person, cover what + when

- ✅ "Generate and validate OpenAPI specs from Express routes. Use when the user wants API documentation or a spec file."
- ❌ "I help you with your API." (first person, vague, no triggers)

### Front-load trigger words

Include the literal words/phrases a user is likely to type. If the skill is for changelogs, the words "changelog", "release notes", "CHANGELOG.md" should appear. Trailing keyword lists are fine and effective:

> "…Actions: generate, update changelog. Files: CHANGELOG.md, releases."

### Be specific enough to NOT over-trigger

A description that's too broad fires on unrelated tasks and pollutes context. Name the boundary: "Handles X. Does not handle Y."

## Progressive disclosure — keep context cheap

| Level | What | When loaded |
|-------|------|-------------|
| 1 | `name` + `description` | Always |
| 2 | `SKILL.md` body | On activation |
| 3 | `references/`, `scripts/`, `assets/` | On demand, when body points to them |

Rules of thumb:
- If content is needed **every** time → body.
- If needed **sometimes** (a specific branch of the workflow) → `references/`.
- If it's **code you'd otherwise rewrite** each run → `scripts/` (deterministic, testable, token-saving).
- If it's a **template/boilerplate** copied into output → `assets/`.

Keep the body under ~500 lines. If a section balloons, move it to a reference and link it.

## Scripts over regenerated code

When a task needs the same code each time (parsing, formatting, API calls), ship a script. Claude runs it instead of re-deriving logic — faster, deterministic, fewer bugs. Make scripts self-contained and give them a `--help`.

## One skill, one job

Skills compose. Prefer several focused skills over one mega-skill. A skill that does "design AND billing AND email" should be three skills. Splitting keeps each description sharp and each body short.

## Naming

- Lowercase, hyphen-separated: `invoice-parser`, not `InvoiceParser` or `invoice_parser`.
- Match any prefix convention already used in the repo's skill directory (e.g. `ckm:`).
- Name the capability, not the implementation: `pdf-form-filler`, not `use-pdflib`.

## Debugging a skill that won't trigger

1. **Read the description as Claude would.** Does it contain the user's likely words? If you'd ask "is this relevant?" and answer "maybe", rewrite it.
2. **Check for over-broad siblings.** Another skill may be matching first. Tighten both descriptions to carve out clear lanes.
3. **Verify frontmatter parses.** A YAML error silently drops the skill. Run the validator.
4. **Confirm location.** It must be in a skills directory the harness scans (e.g. `.claude/skills/<name>/SKILL.md`).
5. **Restart/reload** if the harness caches the skill list, so the new metadata is picked up.

## Common mistakes

- Dumping a 1000-line procedure into the body instead of using references.
- First-person or marketing-style descriptions with no trigger words.
- Absolute paths in scripts/body — always use relative paths from the skill dir.
- Empty `references/`/`scripts/`/`assets/` dirs created "just in case".
- Skills that duplicate an existing one instead of extending it.
