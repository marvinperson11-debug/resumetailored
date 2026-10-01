// Minimal stand-ins for framework modules the real components import, so the
// REAL components can be bundled and driven in Chromium without Next/Clerk.
import * as React from "react";
export default function Link({ href, children, ...rest }: any) { return <a href={typeof href === "string" ? href : href?.pathname} {...rest}>{children}</a>; }
export const usePathname = () => (window as any).__path || "/employer";
export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {} });
export const useParams = () => ({ locale: "en" });
export const useSearchParams = () => new URLSearchParams(location.search);
export const useClerk = () => ({ signOut() {} });
