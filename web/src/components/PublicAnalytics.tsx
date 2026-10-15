'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';

export default function PublicAnalytics() {
  const pathname = usePathname();
  const [hostname, setHostname] = useState('');
  useEffect(() => { setHostname(window.location.hostname); }, []);
  if (!hostname || hostname === 'business.lumenless.com' || pathname.startsWith('/business')) return null;
  return <><Script src="https://www.googletagmanager.com/gtag/js?id=G-7JXQNJFHX6" strategy="afterInteractive" /><Script id="public-google-analytics" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-7JXQNJFHX6');`}</Script></>;
}
