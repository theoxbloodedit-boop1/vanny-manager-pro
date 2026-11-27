import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/lib/providers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

/**
 * Typo système : Plus Jakarta Sans, chargée et bundlée par next/font
 * (aucun fetch runtime → reste disponible hors-ligne, conforme PWA).
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "VANNY MANAGER PRO — Gérez votre activité, proprement",
    template: "%s · VANNY MANAGER PRO",
  },
  description:
    "Ventes, stock, caisses et équipes dans un seul espace. Multi-succursales, multi-rôles, USD et CDF sans les confondre. Conçu pour les entrepreneurs africains.",
  keywords: [
    "gestion de commerce",
    "SaaS gestion",
    "stock",
    "catalogue",
    "équipes",
    "multi-succursales",
    "USD CDF",
    "gestion d'activité RDC",
  ],
  manifest: "/manifest.webmanifest",
  authors: [{ name: "VANNY" }],
  creator: "VANNY",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    siteName: "VANNY MANAGER PRO",
    title: "VANNY MANAGER PRO — Gérez votre activité, proprement",
    description:
      "Le SaaS de gestion pour vos commerces : catalogue, stock, équipes et succursales dans un seul espace. Conçu pour la RDC.",
    images: [
      {
        url: "/icons/icon-192.png",
        width: 192,
        height: 192,
        alt: "VANNY MANAGER PRO",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VANNY MANAGER PRO — Gérez votre activité, proprement",
    description:
      "Catalogue, stock, équipes et succursales dans un seul espace. Conçu pour les entrepreneurs africains.",
    images: ["/icons/icon-192.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b5cff",
  width: "device-width",
  initialScale: 1,
  // Le zoom reste autorisé (accessibilité) — ne jamais bloquer l'agrandissement
  // du texte sur mobile/tablette.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={jakarta.variable}>
      <body className="min-h-screen">
        <Providers>
          {children}
          <ServiceWorkerRegister />
        </Providers>
      </body>
    </html>
  );
}
