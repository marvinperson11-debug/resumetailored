#!/usr/bin/env python3
"""Smoke-test ResumeTailor routes against a running server.

Usage:
    python3 smoke_routes.py --base http://localhost:3000

Hits a set of known public pages, redirect routes, and the health endpoint,
and prints PASS/FAIL per route. Exit code 0 if all pass, 1 otherwise.
Uses only the Python standard library.
"""
import argparse
import sys
import urllib.request
import urllib.error

# (path, allowed status codes). The site 301-redirects *.html -> clean URLs,
# so test the canonical clean URLs (expect 200) and the explicit redirect
# routes separately (expect 301/302).
ROUTES = [
    ("/", {200}),
    ("/how-it-works", {200}),
    ("/blog", {200, 301}),   # directory redirect to /blog/ is fine
    ("/tools/ats-keyword-extractor", {200}),
    ("/alternatives/teal", {200}),
    ("/dashboard", {200}),
    ("/login", {200}),
    ("/signup", {200}),
    # Canonicalization: .html should redirect to the clean URL.
    ("/index.html", {301, 302}),
    ("/how-it-works.html", {301, 302}),
    # Explicit server redirects (server.js).
    ("/app", {301, 302}),     # -> /dashboard  (currently shadowed by static; flags if 200)
    ("/about", {301, 302}),   # -> /how-it-works
    ("/api/health", {200}),
]


def check(base, path, allowed):
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, method="GET")
    try:
        # Don't follow redirects so we can assert on 301/302.
        opener = urllib.request.build_opener(NoRedirect)
        resp = opener.open(req, timeout=10)
        return resp.status, resp.status in allowed
    except urllib.error.HTTPError as e:
        return e.code, e.code in allowed
    except Exception as e:  # noqa: BLE001
        return f"ERR {e}", False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # treat redirect as final response


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:3000")
    args = ap.parse_args()

    failures = 0
    for path, allowed in ROUTES:
        status, ok = check(args.base, path, allowed)
        mark = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"{mark}  {path:40s} -> {status} (want {sorted(allowed)})")

    print(f"\n{len(ROUTES) - failures}/{len(ROUTES)} routes OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
