import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";

import { ConvexClientProvider } from "@/components/custom/convex-client-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Streak",
    template: "%s | Streak",
  },
  description:
    "Streak helps you build habits, stay consistent, and get AI-powered accountability to keep your routine on track.",
  applicationName: "Streak",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  keywords: [
    "habit tracker",
    "streak tracker",
    "accountability app",
    "productivity",
    "ai habit coach",
  ],
  openGraph: {
    type: "website",
    url: "/",
    title: "Streak",
    description:
      "Build better habits with streak tracking, reminders, and AI accountability.",
    siteName: "Streak",
    images: [
      {
        url: "/logo.svg",
        alt: "Streak logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Streak",
    description:
      "Build better habits with streak tracking, reminders, and AI accountability.",
    images: ["/logo.svg"],
  },
  icons: {
    icon: [
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    shortcut: ["/icon.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
