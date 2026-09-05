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
          colorPrimary: "#C9A96E",
          colorBackground: "#1A2F2F",
          colorText: "#F5F0E8",
          colorInputBackground: "#0A1628",
          colorInputText: "#F5F0E8",
        },
      }}
    >
      <html lang="en" className="dark">
        <body
          className={`${inter.variable} ${playfair.variable} bg-navy text-cream font-sans antialiased`}
        >
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
