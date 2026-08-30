import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AutoApply — apply to jobs in seconds",
  description:
    "Review matched jobs, tailor your resume with AI, and auto-fill applications on LinkedIn, Greenhouse, Lever, and Workday. You always review and submit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
