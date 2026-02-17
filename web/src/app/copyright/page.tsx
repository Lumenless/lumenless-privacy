'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';

export default function CopyrightPage() {
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
              Copyright Notice
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
            <h2 className="text-2xl font-semibold mb-4">Ownership</h2>
            <p className="text-muted-foreground leading-relaxed">
              Copyright &copy; 2025 Lumenless. All rights reserved unless otherwise stated.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              The Lumenless platform, including the web application, mobile application (iOS and Android),
              backend services, smart contracts, and all associated intellectual property, is owned and
              maintained by Lumenless. This includes all original source code, user interface designs,
              graphics, logos, and documentation created by the Lumenless team.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Protected Works</h2>
            <p className="text-muted-foreground leading-relaxed">
              The following elements are protected under applicable copyright and intellectual property laws:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">Software</strong> &mdash; The Lumenless web application (Next.js),
                mobile application (React Native / Expo), and all server-side components.
              </li>
              <li>
                <strong className="text-foreground">Smart Contracts</strong> &mdash; On-chain programs deployed on the
                Solana blockchain, including the Lumen ID Soul Bound Token (SBT) minting contract.
              </li>
              <li>
                <strong className="text-foreground">Brand Assets</strong> &mdash; The Lumenless name, logo, visual identity,
                color scheme, and all related brand materials.
              </li>
              <li>
                <strong className="text-foreground">Documentation</strong> &mdash; All user guides, API documentation,
                developer resources, and supporting materials.
              </li>
              <li>
                <strong className="text-foreground">User Interface</strong> &mdash; Original designs, layouts, animations,
                and interactive elements across all Lumenless platforms.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Open-Source License</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Lumenless source code is released under the{' '}
              <Link href="/license" className="text-primary hover:underline">
                MIT License
              </Link>, which permits use, modification, and distribution of the software. This open-source
              license applies to the codebase and does not extend to trademarks, brand assets, or
              proprietary services operated by Lumenless.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Permitted Use</h2>
            <p className="text-muted-foreground leading-relaxed">
              Under the terms of the MIT License, you are permitted to:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>Use the software for personal, educational, or commercial purposes.</li>
              <li>Modify the source code and create derivative works.</li>
              <li>Distribute original or modified versions of the software.</li>
              <li>Include the software in proprietary projects.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              All distributions must include the original copyright notice and the MIT License text.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Restrictions</h2>
            <p className="text-muted-foreground leading-relaxed">
              The following uses are expressly prohibited without prior written consent from Lumenless:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>Use of the Lumenless name, logo, or brand assets to imply endorsement or affiliation.</li>
              <li>Misrepresentation of modified versions as official Lumenless software.</li>
              <li>Removal of copyright notices, attribution, or license information from distributed copies.</li>
              <li>Use of the software in any manner that violates applicable laws or regulations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Third-Party Content</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lumenless integrates third-party open-source software, each subject to its own license terms.
              These include components from the Solana ecosystem, React and React Native frameworks,
              Firebase services, and various cryptographic libraries. Users are responsible for complying
              with the respective licenses of these dependencies.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">DMCA &amp; Copyright Infringement</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lumenless respects the intellectual property rights of others. If you believe that any
              content on our platform infringes your copyright, please contact us with the following
              information:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>A description of the copyrighted work you claim has been infringed.</li>
              <li>The location of the infringing material on our platform.</li>
              <li>Your contact information (name, address, email, phone number).</li>
              <li>A statement that you have a good faith belief the use is not authorized.</li>
              <li>A statement, under penalty of perjury, that the information is accurate and you are the copyright owner or authorized to act on their behalf.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For copyright inquiries, DMCA notices, or permission requests, please reach out
              through our official channels on{' '}
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
