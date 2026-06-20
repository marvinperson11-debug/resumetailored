#!/usr/bin/env python3
"""Validate an Agent Skill directory.

Usage:
    python3 validate_skill.py <skill-dir>

Checks:
  - SKILL.md exists
  - YAML frontmatter is present and parses
  - required fields: name, description
  - name format and length, description length
  - relative paths mentioned in the body that point to bundled files exist

Exit code 0 = valid, 1 = problems found.
"""
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^(?:[a-z0-9]+:)?[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_frontmatter(text):
    if not text.startswith("---"):
        return None, "missing YAML frontmatter (must start with '---')"
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None, "frontmatter not closed with a second '---'"
    raw = parts[1]
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(raw)
        if not isinstance(data, dict):
            return None, "frontmatter did not parse to a mapping"
        return data, None
    except ModuleNotFoundError:
        # Minimal fallback parser for top-level "key: value" pairs.
        data = {}
        for line in raw.splitlines():
            m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
            if m:
                data[m.group(1)] = m.group(2).strip().strip('"')
        return data, None
    except Exception as e:  # noqa: BLE001
        return None, f"frontmatter YAML error: {e}"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_skill.py <skill-dir>", file=sys.stderr)
        return 1
    skill_dir = Path(sys.argv[1])
    skill_md = skill_dir / "SKILL.md"
    errors, warnings = [], []

    if not skill_md.exists():
        print(f"FAIL: {skill_md} not found", file=sys.stderr)
        return 1

    text = skill_md.read_text()
    data, err = parse_frontmatter(text)
    if err:
        print(f"FAIL: {err}", file=sys.stderr)
        return 1

    name = data.get("name")
    desc = data.get("description")

    if not name:
        errors.append("missing required field: name")
    else:
        if not NAME_RE.match(str(name)):
            errors.append(f"name '{name}' must be lowercase/hyphens "
                          f"(optional 'prefix:')")
        if len(str(name)) > 64:
            errors.append("name exceeds 64 chars")

    if not desc:
        errors.append("missing required field: description")
    else:
        if len(str(desc)) > 1024:
            errors.append("description exceeds 1024 chars")
        if len(str(desc)) < 20:
            warnings.append("description is very short — add trigger words")

    # Check relative file references in the body actually exist.
    body = text.split("---", 2)[-1]
    for rel in re.findall(r"`((?:references|scripts|assets)/[^`]+)`", body):
        if not (skill_dir / rel).exists():
            warnings.append(f"referenced file not found: {rel}")

    for w in warnings:
        print(f"WARN: {w}")
    for e in errors:
        print(f"FAIL: {e}", file=sys.stderr)

    if errors:
        return 1
    print(f"OK: {skill_md} is valid"
          + (f" ({len(warnings)} warning(s))" if warnings else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
