import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ChainConfigProvider } from "@/contexts/ChainConfigContext";
import { WalletProvider } from "@/contexts/WalletContext";
import Header from "@/components/Header";

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
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <ChainConfigProvider>
          <WalletProvider>
            <Header />
            <main className="flex-1">{children}</main>
          </WalletProvider>
        </ChainConfigProvider>
      </body>
    </html>
  );
}
