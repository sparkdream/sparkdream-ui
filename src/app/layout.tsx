import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ChainConfigProvider } from "@/contexts/ChainConfigContext";
import { WalletProvider } from "@/contexts/WalletContext";
import Header from "@/components/Header";
import Ticker from "@/components/Ticker";
import BackgroundField from "@/components/BackgroundField";
import ChainStatusBanner from "@/components/ChainStatusBanner";
import VersionFooter from "@/components/VersionFooter";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spark Dream",
  description: "Spark Dream blockchain interface",
  other: { "app-version": process.env.NEXT_PUBLIC_APP_VERSION ?? "" },
  alternates: {
    types: {
      "application/rss+xml": [
        { url: "/feed.xml", title: "Spark Dream — onchain updates" },
      ],
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <BackgroundField />
        <ChainConfigProvider>
          <WalletProvider>
            <Ticker />
            <Header />
            <ChainStatusBanner />
            <main className="flex-1">{children}</main>
            <VersionFooter />
          </WalletProvider>
        </ChainConfigProvider>
      </body>
    </html>
  );
}
