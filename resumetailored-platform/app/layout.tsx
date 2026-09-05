import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Resume Tailored — A private office for your ambitions",
  description:
    "A private office for your ambitions. Hiring for employers, tailored careers for candidates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#8B5CF6",
          colorBackground: "#0B0F19",
          colorText: "#FFFFFF",
          colorInputBackground: "#0B0F19",
          colorInputText: "#FFFFFF",
        },
      }}
    >
      <html lang="en" className="dark">
        <body
          className={`${inter.variable} ${playfair.variable} bg-navy text-cream font-sans antialiased`}
        >
          {/* Living gradient — fixed behind all content, shows through glass. */}
          <div className="gradient-bg" aria-hidden="true" />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
