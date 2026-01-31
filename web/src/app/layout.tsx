import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumenless - Building The Future Of Privacy On Solana",
  description: "Join the waitlist for Lumenless. Building the future of privacy on Solana.",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
  },
  openGraph: {
    title: "Lumenless - Building The Future Of Privacy On Solana",
    description: "Join the waitlist for Lumenless. Building the future of privacy on Solana.",
    images: ['/logo.svg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: "Lumenless - Building The Future Of Privacy On Solana",
    description: "Join the waitlist for Lumenless. Building the future of privacy on Solana.",
    images: ['/logo.svg'],
  },
};

const GA_MEASUREMENT_ID = 'G-7JXQNJFHX6';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Google tag (gtag.js) - loads on every page */}
        <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_MEASUREMENT_ID}');
            `,
          }}
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
