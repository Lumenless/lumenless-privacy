import type { Metadata } from "next";
import "./globals.css";
import PublicAnalytics from "@/components/PublicAnalytics";

export const metadata: Metadata = {
  title: "Lumenless — Your voice. Our timeline.",
  description: "Buy a tweet or thread on @lumenless. Pay with LUMEN or SOL, submit your content, and get published after approval.",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
  },
  openGraph: {
    title: "Lumenless — Your voice. Our timeline.",
    description: "Buy a tweet or thread on @lumenless with LUMEN or SOL.",
    images: ['/logo.svg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: "Lumenless — Your voice. Our timeline.",
    description: "Buy a tweet or thread on @lumenless with LUMEN or SOL.",
    images: ['/logo.svg'],
  },
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <PublicAnalytics />
      </body>
    </html>
  );
}
