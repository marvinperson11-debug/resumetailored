# UserButton menu theming + Settings owner-gate fix

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript · Clerk)

Small PR, two fixes. **No new dependencies.** `tsc`, `next lint`, and `next build` are all green.
**No migration needed.**

---

## 1. Clerk UserButton popover — readable in the dark theme

The avatar dropdown items ("Manage account / Profile / Upload photo / Sign out") were rendering
ghosted — Clerk's default light popover text sat on our dark card. Fixed by theming the
`<UserButton>` `appearance` in `components/profile-button.tsx`:

- **`variables`** set a navy popover background (`#0B0F19`) with near-white primary text (`#F8FAFC`),
  muted secondary text (`#A9AEB8`), and the app's violet accent (`#8B5CF6`) — so *all* item text is
  legible regardless of which elements Clerk renders.
- **`elements`** add visible hover/pressed states and match the app palette:
  `userButtonPopoverCard` (navy + hairline border), `…ActionButton` / `…CustomItemButton`
  (near-white text, `hover:bg-white/10`, `active:bg-white/[0.14]`), muted icons, themed footer.

Both the built-in actions (Manage account, Sign out) and our custom items (Profile, Settings,
Language, Upload photo) are covered. `ProfileButton` is shared, so this applies in **both** the
employer and candidate shells.

---

## 2. Settings page "frozen" — the owner gate locked out the admin

**Root cause.** The Settings page computed editability as `canManage = access.plan === "employer"`.
The reporting user is the **platform admin** (Clerk id `user_3Iy2uXv7HW15FGIF1b3mv7iZm1M`, the
hardcoded `ADMIN_USER_ID`). `getAccess()` resolves the admin to `{ plan: "pro", isAdmin: true }`
(admin bypass), **not** `plan: "employer"` — so `canManage` was `false`, every field rendered with
the native `disabled` attribute, and the page showed "Only the account owner can edit." The data
still loaded (hence the saved company name showing), which matched the symptom exactly.

**Fix** (`app/employer/settings/page.tsx`): editability is now
`canManage = isEmployer(access)`, where `isEmployer` is exactly **`plan === "employer" || isAdmin`** —
i.e. the workspace owner *or* the platform admin. (The workspace is keyed by the owner's own Clerk
id — `employer_profiles.user_id` — so "owner" = the `plan: "employer"` account; an invited
*employee* stays correctly read-only.) The same `canManage` flows to the Email-signature panel, so
both edit the same way.

- Fields are enabled via the native `disabled` attribute only — there is **no** `pointer-events:none`
  anywhere — so a `true` gate genuinely re-enables typing/clicking.
- The decision is **logged once** to the browser console for verification:
  `[settings] editability gate { canManage, plan, isAdmin }`.

---

## Files
- `components/profile-button.tsx` — dark-theme the UserButton popover (variables + element classes).
- `app/employer/settings/page.tsx` — `canManage = isEmployer(access)` (owner **or** admin); pass gate info.
- `app/employer/settings/settings-client.tsx` — accept `gate`, log the gate decision once on mount.

## Verify
```bash
cd resumetailored-platform
npx tsc --noEmit   # ✔ no errors
npx next lint      # ✔ no warnings or errors
npx next build     # ✔ compiles
```
In the browser: open the avatar menu (items now legible with hover states) and `/employer/settings`
as the admin/owner — all fields editable; the console prints the gate line
`{ canManage: true, plan: "pro", isAdmin: true }`.
