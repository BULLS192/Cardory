import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CARDORY",
  description: "A multi-TCG collector OS for scanning, cataloging, valuing, organizing and sharing your cards.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
