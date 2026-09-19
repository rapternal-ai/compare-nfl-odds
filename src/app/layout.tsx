import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NFL Market Scanner",
  description: "Read-only Kalshi NFL candidate decisions",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
