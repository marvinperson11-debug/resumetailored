import { LoadingScreen } from "@/components/loading-screen";

// Instant fallback while the root route resolves the user's role and redirects
// (auth() + getAccess()). Shown by Next.js the moment navigation to "/" starts,
// so login no longer lands on a blank gradient.
export default function Loading() {
  return <LoadingScreen />;
}
