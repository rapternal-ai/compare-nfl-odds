import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NFL Market Odds Intelligence",
  description: "Read-only Kalshi NFL candidate decisions",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer>Sample data — for evaluation only, not live odds.</footer>
      </body>
    </html>
  );
}
