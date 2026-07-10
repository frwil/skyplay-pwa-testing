import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "SKY PLAY — PWA Compagnon | Tests Utilisateurs",
  description:
    "Outil compagnon PWA pour la phase de test utilisateur de la plateforme skyplay.cloud — soumettez vos feedbacks et captures d'écran.",
  keywords:
    "SKY PLAY, PWA, test utilisateur, feedback, skyplay, e-sport, Cameroun",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SKY PLAY PWA",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#0097FC",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className="h-full antialiased">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        <Script id="locale-detect" strategy="beforeInteractive">{`(function(){var c=document.cookie.split("; ").find(function(r){return r.startsWith("skyplay-locale=")});var l=c?c.split("=")[1]:"fr";if(l==="fr"||l==="en")document.documentElement.lang=l})()`}</Script>
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
