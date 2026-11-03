import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Geist (SIL OFL 1.1, see app/fonts/GEIST-LICENSE.txt), bundled locally so builds never fetch fonts.
const sans = localFont({ src: "./fonts/Geist-Variable.woff2", variable: "--font-geist", weight: "100 900", display: "swap" });
const mono = localFont({ src: "./fonts/GeistMono-Variable.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: "ContractRadar",
  description: "Agentic federal contracting intelligence for small defense-industry suppliers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
