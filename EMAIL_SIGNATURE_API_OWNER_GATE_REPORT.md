# Email-signature save fix — API owner gate now allows the admin

Feature branch: `claude/esignatures-document-uploads-973zwc`
App: `resumetailored-platform/` (Next.js 14 · TypeScript · Clerk)

Quick fix. **No new dependencies. No migration.** `tsc`, `next lint`, and `next build` are all green.

---

## The problem

The Settings page gate was fixed last PR (owner **or** admin), so the email-signature fields
render editable — but **saving** still returned `403 "Only the account owner can edit the
signature."` The two API routes behind the panel still used the old, stricter check
`ctx.access.plan !== "employer"`, which excludes the platform admin (the admin resolves to
`plan: "pro"` + `isAdmin: true`, not `plan: "employer"`). So the client could edit but the server
rejected the write.

## The fix

Both routes now use the same shared rule as the page — `isEmployer(access)`, i.e.
**`plan === "employer" || isAdmin`**:

- `app/api/employer/email-signature/route.ts` (POST — save/clear the signature)
- `app/api/employer/email-signature/asset/route.ts` (POST — logo/photo upload)

`isEmployer` is imported from `@/lib/plan` (the single source of truth also used by the Settings
page and the employer layout), so the page and the API can't drift apart again. An invited
*employee* (plan `"employee"`) stays correctly read-only.

No other route needed this change: the company-profile save (`/api/employer/profile`) already gates
only on `requireEmployerId` (admin passes), and the GET on the signature route is not owner-gated.

---

## Files
- `app/api/employer/email-signature/route.ts` — POST gate → `!isEmployer(ctx.access)`.
- `app/api/employer/email-signature/asset/route.ts` — POST gate → `!isEmployer(ctx.access)`.

## Verify
```bash
cd resumetailored-platform
npx tsc --noEmit   # ✔ no errors
npx next lint      # ✔ no warnings or errors
npx next build     # ✔ compiles
```
Once this is deployed: on `/employer/settings`, edit the email signature and **Save signature** —
it should save (no 403), and the logo upload should work too.
