import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/inter";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: {
    default: "NyxMail — encrypted email, by construction",
    template: "%s · NyxMail",
  },
  description:
    "A self-hosted, zero-access encrypted webmail service. Your keys never leave your browser, and your server only stores ciphertext.",
  applicationName: "NyxMail",
  authors: [{ name: "NyxMail" }],
  keywords: ["encrypted email", "private email", "self-hosted webmail", "zero access encryption"],
  openGraph: {
    title: "NyxMail — encrypted email, by construction",
    description: "Self-hosted, zero-access encrypted webmail. The server only stores ciphertext.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#27252C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = headers().get("x-nonce") || undefined;
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nyxmail-theme');if(t==='light'){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.documentElement.style.colorScheme='light';}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only z-[200] rounded-lg bg-accent px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
