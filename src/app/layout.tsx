import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Voice-to-Task Capture Tool",
  description:
    "Press one key, speak a thought, get a parsed task — title, due date, project, priority — auto-added to your todo system. Voice memo mode captures raw audio for later transcription.",
  keywords: [
    "voice-to-task",
    "ASR",
    "speech-to-text",
    "task capture",
    "Next.js",
    "Prisma",
    "z-ai-web-dev-sdk",
  ],
  authors: [{ name: "Voice-to-Task" }],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
