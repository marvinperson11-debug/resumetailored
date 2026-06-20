#!/usr/bin/env python3
"""Static scan of ResumeTailor HTML pages for common problems.

Usage:
    python3 scan_pages.py public

Flags, per file:
  - local href/src targets that don't resolve to a file on disk
  - missing <title>
  - missing <meta name="description">
  - missing canonical link and og:title
  - empty or placeholder links (href="#", href="")

Stdlib only. Exit 0 always (reporting tool); summary printed at end.
"""
import re
import sys
from pathlib import Path
from html.parser import HTMLParser

LINK_ATTRS = {"href", "src"}
EXTERNAL = re.compile(r"^(https?:)?//|^(mailto:|tel:|data:|javascript:|#)")

# Virtual routes served by Express (server.js) that have no file on disk.
# Links to these are valid even though no matching file exists.
KNOWN_ROUTES = {
    "/", "/dashboard", "/login", "/signup", "/app", "/about", "/blog",
}


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self._in_title = False
        self.has_desc = False
        self.has_canonical = False
        self.has_og_title = False
        self.noindex = False
        self.local_links = []   # (attr, value)
        self.empty_links = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            if a.get("name", "").lower() == "description":
                self.has_desc = True
            if a.get("property", "").lower() == "og:title":
                self.has_og_title = True
            if a.get("name", "").lower() == "robots" \
                    and "noindex" in a.get("content", "").lower():
                self.noindex = True
        if tag == "link" and a.get("rel", "").lower() == "canonical":
            self.has_canonical = True
        for attr in LINK_ATTRS:
            if attr in a:
                val = (a[attr] or "").strip()
                if val in ("", "#"):
                    # href="#" with an onclick handler is an intentional JS
                    # trigger (e.g. opening a modal), not a dead link.
                    if val == "#" and a.get("onclick"):
                        continue
                    self.empty_links.append((attr, val))
                elif not EXTERNAL.match(val):
                    self.local_links.append((attr, val))

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and data.strip():
            self.title = (self.title or "") + data.strip()


def resolve(root: Path, page: Path, link: str) -> bool:
    link = link.split("#")[0].split("?")[0]
    if not link:
        return True
    # Express virtual routes (and anything under /api/) have no disk file.
    if link.rstrip("/") in KNOWN_ROUTES or link.startswith("/api/"):
        return True
    base = root if link.startswith("/") else page.parent
    target = (base / link.lstrip("/")).resolve()
    if target.exists():
        return True
    # Allow extension-less routes that map to .html
    if (target.with_suffix(".html")).exists():
        return True
    if target.is_dir() and (target / "index.html").exists():
        return True
    return False


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
    files = sorted(root.rglob("*.html"))
    broken = meta = 0
    for f in files:
        p = PageParser()
        try:
            p.feed(f.read_text(errors="replace"))
        except Exception as e:  # noqa: BLE001
            print(f"[parse-error] {f}: {e}")
            continue
        rel = f.relative_to(root)
        issues = []
        for attr, link in p.local_links:
            if not resolve(root, f, link):
                issues.append(f"broken {attr}: {link}")
                broken += 1
        for attr, link in p.empty_links:
            issues.append(f"empty {attr}: '{link}'")
        # SEO/OG/canonical only matter for indexable pages. noindex pages
        # (dashboards, payment success/cancel, password reset) are exempt.
        if not p.noindex:
            if not p.title:
                issues.append("missing <title>"); meta += 1
            if not p.has_desc:
                issues.append("missing meta description"); meta += 1
            if not p.has_canonical:
                issues.append("missing canonical link"); meta += 1
            if not p.has_og_title:
                issues.append("missing og:title"); meta += 1
        if issues:
            print(f"\n{rel}")
            for i in issues:
                print(f"  - {i}")

    print(f"\nScanned {len(files)} pages | {broken} broken local links | "
          f"{meta} meta/SEO gaps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
