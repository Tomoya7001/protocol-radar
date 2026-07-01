import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Protocol Radar",
  description:
    "AI agent protocol observation index with an HMAC hash-chained ledger.",
};

/**
 * Seed [data-theme] once from the OS preference, before paint, to avoid a flash.
 * Theme is then only ever switched via the [data-theme] attribute (see 02_DESIGN.md §A.7).
 */
const themeSeedScript = `(function(){try{var m=window.matchMedia('(prefers-color-scheme: dark)');document.documentElement.setAttribute('data-theme', m.matches ? 'dark' : 'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeSeedScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
