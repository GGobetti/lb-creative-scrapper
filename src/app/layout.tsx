import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scraper Monitor",
  description: "Monitor de jobs do Telegram Scraper",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
