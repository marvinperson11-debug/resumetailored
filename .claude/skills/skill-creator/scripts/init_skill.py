#!/usr/bin/env python3
"""Scaffold a new Agent Skill directory with a valid SKILL.md.

Usage:
    python3 init_skill.py <skill-name> [--path .claude/skills]
                                       [--prefix ckm:]
                                       [--description "..."]

Creates <path>/<skill-name>/SKILL.md and the standard (empty until used)
subdirectories are intentionally NOT created — add them only when needed.
"""
import argparse
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

TEMPLATE = """\
---
name: {full_name}
description: "{description}"
argument-hint: "[input]"
license: MIT
metadata:
  author: claudekit
  version: "1.0.0"
---

# {title}

One or two sentences: what this skill does and what it explicitly does NOT do.

## When to Use

- Concrete situation or user phrasing that should trigger this skill
- Another trigger

## Workflow

### Step 1: ...

### Step 2: ...

## References

- (add `references/foo.md` here when you create one)
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="Scaffold a new Agent Skill.")
    ap.add_argument("name", help="skill name (lowercase, hyphenated)")
    ap.add_argument("--path", default=".claude/skills",
                    help="skills directory to create the skill in")
    ap.add_argument("--prefix", default="",
                    help="name prefix used by sibling skills, e.g. 'ckm:'")
    ap.add_argument("--description", default="",
                    help="the skill description (you can edit it later)")
    args = ap.parse_args()

    name = args.name.strip()
    if not NAME_RE.match(name):
        print(f"error: '{name}' must be lowercase letters/numbers/hyphens "
              f"(e.g. my-skill)", file=sys.stderr)
        return 2

    skill_dir = Path(args.path) / name
    skill_md = skill_dir / "SKILL.md"
    if skill_md.exists():
        print(f"error: {skill_md} already exists", file=sys.stderr)
        return 1

    full_name = f"{args.prefix}{name}"
    title = name.replace("-", " ").title()
    description = args.description or (
        f"TODO: third-person description of what {title} does and when to "
        f"use it, including trigger words."
    )

    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_md.write_text(
        TEMPLATE.format(full_name=full_name, description=description, title=title)
    )
    print(f"created {skill_md}")
    print("next: edit the description (most important field), then the body.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
