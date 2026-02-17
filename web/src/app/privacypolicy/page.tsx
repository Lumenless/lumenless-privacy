'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';

export default function PrivacyPolicyPage() {
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
              Privacy Policy
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
            <h2 className="text-2xl font-semibold mb-4">Introduction</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lumenless (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy.
              This Privacy Policy explains how we collect, use, and safeguard information when you use
              the Lumenless mobile application, web application, and related services (collectively, the &quot;Service&quot;).
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Lumenless is a privacy-focused payment platform built on Solana. Our core design
              principle is data minimization &mdash; we collect only the information strictly necessary to
              provide the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Information We Collect</h2>

            <h3 className="text-xl font-medium mt-6 mb-3">Wallet Information</h3>
            <p className="text-muted-foreground leading-relaxed">
              When you connect your Solana wallet to Lumenless, we receive your public wallet address.
              This is necessary to facilitate transactions, mint your Lumen ID (Soul Bound Token), and
              interact with the Solana blockchain. We do not have access to your private keys or
              seed phrases at any time.
            </p>

            <h3 className="text-xl font-medium mt-6 mb-3">Locally Stored Data</h3>
            <p className="text-muted-foreground leading-relaxed">
              The following data is stored securely on your device using platform-native secure storage
              (Keychain on iOS, Keystore on Android) and is never transmitted to our servers:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>PayLink private keys (Ed25519 keypairs for payment link wallets)</li>
              <li>PayLink metadata (labels, creation timestamps)</li>
              <li>Onboarding and Lumen ID minting status</li>
            </ul>

            <h3 className="text-xl font-medium mt-6 mb-3">Analytics Data</h3>
            <p className="text-muted-foreground leading-relaxed">
              We use Firebase Analytics (Google) to collect anonymous usage data on the mobile application.
              This includes:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>Screen views (which screens you visit within the app)</li>
              <li>Feature usage events (e.g., wallet connection, payment link creation, withdrawals)</li>
              <li>App performance metrics</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              On the web application, we use Google Analytics (gtag.js) to collect standard web analytics data
              including page views, session duration, and general traffic information.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Analytics data does not include your wallet address, transaction details, or any personally
              identifiable information.
            </p>

            <h3 className="text-xl font-medium mt-6 mb-3">Crash Reports</h3>
            <p className="text-muted-foreground leading-relaxed">
              We use Firebase Crashlytics (Google) to collect crash reports on the mobile application. When the
              app crashes, technical information is collected including stack traces, device type, operating
              system version, and app state at the time of the crash. This data helps us identify and fix
              bugs to improve reliability.
            </p>

            <h3 className="text-xl font-medium mt-6 mb-3">Push Notification Tokens</h3>
            <p className="text-muted-foreground leading-relaxed">
              If you opt in to push notifications, we store an Expo push notification token to deliver
              notifications to your device. You can disable push notifications at any time through your
              device settings.
            </p>

            <h3 className="text-xl font-medium mt-6 mb-3">Waitlist Information</h3>
            <p className="text-muted-foreground leading-relaxed">
              If you sign up for the waitlist on our website, we collect and store your email address
              to notify you about product updates and availability.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Information We Do Not Collect</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lumenless is designed with privacy at its core. We do not collect:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>Private keys, seed phrases, or wallet passwords</li>
              <li>Personal identity information (name, address, phone number, government ID)</li>
              <li>Location data</li>
              <li>Contacts, photos, camera, or microphone access</li>
              <li>Browsing history outside of the Lumenless application</li>
              <li>Transaction contents or payment amounts (these are on-chain and public by nature of the Solana blockchain)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">How We Use Your Information</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use the information we collect for the following purposes:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li><strong className="text-foreground">Service Operation</strong> &mdash; Processing wallet connections, facilitating Lumen ID minting, and enabling payment link functionality.</li>
              <li><strong className="text-foreground">PrivacyCash</strong> &mdash; Computing balances and processing withdrawals through our backend. Wallet addresses and signed authentication messages are sent to our servers for verification.</li>
              <li><strong className="text-foreground">Analytics</strong> &mdash; Understanding how the Service is used to improve functionality and user experience.</li>
              <li><strong className="text-foreground">Crash Reporting</strong> &mdash; Identifying and resolving technical issues to maintain service reliability.</li>
              <li><strong className="text-foreground">Notifications</strong> &mdash; Sending relevant updates about your payment links and transactions (if opted in).</li>
              <li><strong className="text-foreground">Communication</strong> &mdash; Sending waitlist updates and product announcements (if you signed up).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Data Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We implement the following security measures to protect your data:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li><strong className="text-foreground">Encrypted Storage</strong> &mdash; Sensitive data (private keys, keypairs) is stored in your device&apos;s secure enclave using platform-native encryption (iOS Keychain, Android Keystore).</li>
              <li><strong className="text-foreground">HTTPS Only</strong> &mdash; All network communication uses HTTPS encryption. Cleartext traffic is disabled on all platforms.</li>
              <li><strong className="text-foreground">Client-Side Key Generation</strong> &mdash; Cryptographic keys are generated on your device using Ed25519 and never leave your device.</li>
              <li><strong className="text-foreground">Message Signing Authentication</strong> &mdash; PrivacyCash authentication uses cryptographic message signing rather than passwords or tokens.</li>
              <li><strong className="text-foreground">No Server-Side Key Storage</strong> &mdash; We never store, transmit, or have access to your private keys.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Third-Party Services</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lumenless uses the following third-party services that may process data:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">Google Firebase</strong> &mdash; Analytics and crash reporting.
                Subject to{' '}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Google&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <strong className="text-foreground">Google Analytics</strong> &mdash; Web traffic analytics.
                Subject to{' '}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Google&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <strong className="text-foreground">Helius</strong> &mdash; Solana RPC provider for blockchain interactions.
                Processes public blockchain queries (wallet balances, token accounts, transaction status).
              </li>
              <li>
                <strong className="text-foreground">Solana Blockchain</strong> &mdash; All on-chain transactions are publicly
                visible on the Solana network. This is inherent to blockchain technology and not controlled
                by Lumenless.
              </li>
              <li>
                <strong className="text-foreground">Expo</strong> &mdash; Push notification delivery service.
                Subject to{' '}
                <a href="https://expo.dev/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Expo&apos;s Privacy Policy
                </a>.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Blockchain Transparency</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lumenless operates on the Solana blockchain. By nature, blockchain transactions are
              publicly visible and immutable. While Lumenless provides privacy-enhancing features
              through PrivacyCash, standard on-chain transactions (such as Lumen ID minting and
              public token claims) are recorded on the public ledger. Lumenless does not control
              the visibility of on-chain data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Data Retention</h2>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li><strong className="text-foreground">Device Data</strong> &mdash; Stored locally until you delete the app or clear app data.</li>
              <li><strong className="text-foreground">Analytics Data</strong> &mdash; Retained by Google Firebase and Google Analytics according to their standard retention policies (typically 14 months).</li>
              <li><strong className="text-foreground">Crash Reports</strong> &mdash; Retained by Firebase Crashlytics for 90 days.</li>
              <li><strong className="text-foreground">Blockchain Data</strong> &mdash; On-chain transactions are permanent and immutable.</li>
              <li><strong className="text-foreground">Waitlist Data</strong> &mdash; Retained until you request removal or the waitlist is closed.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">
              You have the following rights regarding your data:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li><strong className="text-foreground">Access</strong> &mdash; You can view all locally stored data through the app.</li>
              <li><strong className="text-foreground">Deletion</strong> &mdash; You can delete all local data by uninstalling the app. For waitlist removal, contact us directly.</li>
              <li><strong className="text-foreground">Opt-Out</strong> &mdash; You can disable push notifications through your device settings and decline analytics collection where applicable.</li>
              <li><strong className="text-foreground">Data Portability</strong> &mdash; You can export your PayLink private keys through the backup feature in the app.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Children&apos;s Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lumenless is not intended for use by anyone under the age of 18. We do not knowingly
              collect information from children. If you believe a child has provided us with personal
              information, please contact us so we can take appropriate action.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">App Permissions</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Lumenless mobile application requests only the minimum permissions necessary:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li><strong className="text-foreground">Internet Access</strong> &mdash; Required for blockchain interactions, API calls, and analytics.</li>
              <li><strong className="text-foreground">Network State</strong> &mdash; Required to check connectivity before making network requests.</li>
              <li><strong className="text-foreground">Push Notifications</strong> &mdash; Optional, requested with your consent after onboarding.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              We do not request access to your camera, microphone, contacts, location, photos, or any
              other sensitive device capabilities.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this Privacy Policy from time to time. Changes will be posted on this page
              with an updated &quot;Last updated&quot; date. We encourage you to review this policy periodically.
              Continued use of the Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have questions about this Privacy Policy or our data practices, please contact us
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
