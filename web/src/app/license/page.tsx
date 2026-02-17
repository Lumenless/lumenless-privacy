'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';

export default function LicensePage() {
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: '#ffffff' }}>
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.1 }}
          transition={{ duration: 1 }}
          className="hidden md:block absolute top-20 -left-20 w-64 h-64 md:w-80 md:h-80 rounded-full blur-3xl"
          style={{ backgroundColor: '#8b5cf6' }}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="hidden md:block absolute bottom-20 -right-20 w-64 h-64 md:w-80 md:h-80 rounded-full blur-3xl"
          style={{ backgroundColor: '#8b5cf6' }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.svg" alt="Lumenless Logo" width={40} height={40} />
            <span className="text-xl font-semibold">Lumenless</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="relative z-10 container mx-auto px-4 py-12 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-12 text-center"
        >
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
              License
            </span>
          </h1>
          <p className="text-muted-foreground">Last updated: February 17, 2026</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="prose prose-gray max-w-none space-y-8 text-foreground"
        >
          <section>
            <h2 className="text-2xl font-semibold mb-4">MIT License</h2>
            <p className="text-muted-foreground leading-relaxed">
              Copyright (c) 2025 Lumenless
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Permission is hereby granted, free of charge, to any person obtaining a copy
              of this software and associated documentation files (the &quot;Software&quot;), to deal
              in the Software without restriction, including without limitation the rights
              to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
              copies of the Software, and to permit persons to whom the Software is
              furnished to do so, subject to the following conditions:
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              The above copyright notice and this permission notice shall be included in all
              copies or substantial portions of the Software.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4 uppercase text-sm">
              THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
              IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
              AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
              LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
              OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
              SOFTWARE.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Scope of License</h2>
            <p className="text-muted-foreground leading-relaxed">
              This license applies to the Lumenless open-source codebase, including the web application,
              mobile application, and associated tooling. The license grants users the freedom to use,
              modify, and distribute the software while ensuring transparency and compliance with
              open-source principles.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Third-Party Dependencies</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lumenless incorporates third-party open-source libraries and tools, each governed by
              their respective licenses. Key dependencies include:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">Solana SDK &amp; Tools</strong> &mdash; Licensed under the Apache License 2.0.
                Includes @solana/kit, @solana/web3.js, and Solana Mobile Wallet Adapter.
              </li>
              <li>
                <strong className="text-foreground">React &amp; React Native</strong> &mdash; Licensed under the MIT License.
                Used for the web and mobile application interfaces.
              </li>
              <li>
                <strong className="text-foreground">Next.js</strong> &mdash; Licensed under the MIT License.
                Framework powering the Lumenless web application.
              </li>
              <li>
                <strong className="text-foreground">Expo</strong> &mdash; Licensed under the MIT License.
                Framework used for the Lumenless mobile application.
              </li>
              <li>
                <strong className="text-foreground">Firebase SDKs</strong> &mdash; Licensed under the Apache License 2.0.
                Used for analytics and crash reporting in the mobile application.
              </li>
              <li>
                <strong className="text-foreground">TweetNaCl</strong> &mdash; Public domain. Used for cryptographic key generation.
              </li>
              <li>
                <strong className="text-foreground">PrivacyCash SDK</strong> &mdash; Used for privacy-enhanced payment functionality.
              </li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Users are responsible for reviewing and complying with the licenses of all third-party
              dependencies when redistributing or modifying the software.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Trademarks</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Lumenless name, logo, and brand assets are trademarks of Lumenless and are not
              covered by the MIT License. Use of these trademarks requires prior written permission,
              except for reasonable and customary use in describing the origin of the software.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For questions about this license or to request permission for trademark usage,
              please reach out through our official channels on{' '}
              <a href="https://x.com/lumenless" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                X (Twitter)
              </a>{' '}
              or{' '}
              <a href="https://discord.gg/Dn7YQjKY9h" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Discord
              </a>.
            </p>
          </section>
        </motion.div>
      </main>

      {/* Footer */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="relative z-10 border-t border-border py-8 text-center text-sm text-muted-foreground"
      >
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-center gap-4">
          <p>&copy; 2025 Lumenless. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/license" className="hover:text-primary transition-colors">License</Link>
            <Link href="/copyright" className="hover:text-primary transition-colors">Copyright</Link>
            <Link href="/privacypolicy" className="hover:text-primary transition-colors">Privacy Policy</Link>
          </div>
        </div>
      </motion.footer>
    </div>
  );
}
