import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://cardory.omnidite.com"),
  title: {
    default: "CARDORY",
    template: "%s · CARDORY",
  },
  applicationName: "CARDORY",
  description:
    "A multi-TCG collector OS for scanning, cataloging, valuing, organizing and sharing your cards.",
  alternates: {
    canonical: "/",
  },
  appleWebApp: {
    capable: true,
    title: "CARDORY",
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0B0F1A",
  colorScheme: "dark light",
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
