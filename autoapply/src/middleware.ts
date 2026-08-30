export { default } from "next-auth/middleware";

// Protect the dashboard. Unauthenticated users are redirected to `/`
// (the sign-in page configured in authOptions.pages.signIn).
export const config = {
  matcher: ["/dashboard/:path*"],
};
