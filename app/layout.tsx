import type { Metadata } from "next";
import "./globals.css";

// System font stack (no next/font/google) so builds never depend on fetching fonts.
export const metadata: Metadata = {
  title: "ContractRadar",
  description:
    "Agentic federal contracting intelligence for small defense-industry suppliers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
