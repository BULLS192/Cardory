import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CARDORY",
    short_name: "CARDORY",
    description:
      "A multi-TCG collector OS for scanning, cataloging, valuing, organizing and sharing your cards.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0F1A",
    theme_color: "#0B0F1A",
    orientation: "any",
    icons: [
      {
        src: "/icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
