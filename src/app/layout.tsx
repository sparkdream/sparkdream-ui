import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ChainConfigProvider } from "@/contexts/ChainConfigContext";
import { WalletProvider } from "@/contexts/WalletContext";
import Header from "@/components/Header";
import Ticker from "@/components/Ticker";
import BackgroundField from "@/components/BackgroundField";
import ChainStatusBanner from "@/components/ChainStatusBanner";
import TombstoneBanner from "@/components/identity/TombstoneBanner";
import VersionFooter from "@/components/VersionFooter";

// Geist is bundled (src/app/fonts, SIL Open Font License 1.1, see OFL.txt
// there) instead of fetched from Google Fonts, so a build needs no network
// beyond npm. The files are the variable fonts from the `geist` npm package.
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  // The default metric-matched fallback is Arial, which is wrong for monospace.
  adjustFontFallback: false,
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
      <head>
        <link rel="me" href="https://mstdn.sparkdream.io/@kingofbitchain" />
        <link rel="me" href="https://mastodon.social/@kingofbitchain" />
      </head>
      <body className="min-h-full flex flex-col">
        <BackgroundField />
        <ChainConfigProvider>
          <WalletProvider>
            <Ticker />
            <Header />
            <ChainStatusBanner />
            <TombstoneBanner />
            <main className="flex-1">{children}</main>
            <VersionFooter />
          </WalletProvider>
        </ChainConfigProvider>
      </body>
    </html>
  );
}
