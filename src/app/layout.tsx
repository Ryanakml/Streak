import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { JetBrains_Mono } from "next/font/google";

import { ConvexClientProvider } from "@/components/custom/convex-client-provider";
import { ThemeProvider } from "@/components/custom/theme-provider";

import "./globals.css";

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-brutal-mono",
  subsets: ["latin"],
});

const isDev = process.env.NODE_ENV === "development";
const appTitle = isDev ? "Streak - dev" : "Streak";

export const metadata: Metadata = {
  title: {
    default: appTitle,
    template: `%s | ${appTitle}`,
  },
  description:
    "Streak helps you build habits, stay consistent, and get AI-powered accountability to keep your routine on track.",
  applicationName: appTitle,
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
    title: appTitle,
    description:
      "Build better habits with streak tracking, reminders, and AI accountability.",
    siteName: appTitle,
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
        className={`${jetBrainsMono.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="min-h-full flex flex-col">
          <ThemeProvider defaultTheme="light">
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
