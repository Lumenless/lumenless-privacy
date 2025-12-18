'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import WaitlistForm from '@/components/WaitlistForm';

export default function Home() {
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
        
        {/* Floating particles */}
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 0 }}
            animate={{
              opacity: [0, 0.3, 0],
              y: [-100, -600],
              x: Math.random() * 100 - 50,
            }}
            transition={{
              duration: Math.random() * 3 + 2,
              repeat: Infinity,
              delay: Math.random() * 5,
            }}
            className="absolute w-1 h-1 md:w-2 md:h-2 rounded-full pointer-events-none"
            style={{
              backgroundColor: '#8b5cf6',
              left: `${Math.random() * 100}%`,
              bottom: 0,
              zIndex: 1,
            }}
          />
        ))}
      </div>

      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-20 overflow-visible">
        <div className="w-full max-w-4xl mx-auto text-center space-y-8 min-h-0">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-8"
          >
            <Image
              src="/logo.svg"
              alt="Lumenless Logo"
              width={120}
              height={120}
              priority
              className="mx-auto"
            />
          </motion.div>

          {/* Hero Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold tracking-tight leading-tight py-4"
          >
            <motion.span
              className="inline-block bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent"
              animate={{
                backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
              }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: 'linear',
              }}
              style={{
                backgroundSize: '200% 200%',
                lineHeight: '1.1',
                display: 'inline-block',
                paddingBottom: '0.2em',
              }}
            >
              Lumenless
            </motion.span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            Building The Future Of Privacy On Solana.
            <br />
            Private payments. Private trading. Private [redacted].
          </motion.p>

          {/* Waitlist Form */}
          <div className="flex justify-center pt-4">
            <WaitlistForm />
          </div>

          {/* Private Payments Demo Link */}
          {/* <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="pt-6"
          >
            <motion.a
              href="/private-payments"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="inline-flex items-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              🔒 Try Private Payments Demo
            </motion.a>
          </motion.div> */}

          {/* Social Links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="flex items-center justify-center gap-4 pt-8"
          >
            <motion.a
              href="https://x.com/lumenless"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="p-3 rounded-full bg-card border border-border hover:border-primary transition-colors"
            >
              <Image
                src="/twitter.svg"
                alt="Twitter"
                width={24}
                height={24}
                className="w-6 h-6 [filter:brightness(0)_saturate(100%)_invert(45%)_sepia(93%)_saturate(6494%)_hue-rotate(246deg)_brightness(102%)_contrast(101%)]"
              />
            </motion.a>
            <motion.a
              href="https://discord.gg/Dn7YQjKY9h"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="p-3 rounded-full bg-card border border-border hover:border-primary transition-colors"
            >
              <Image
                src="/discord.svg"
                alt="Discord"
                width={24}
                height={24}
                className="w-6 h-6 [filter:brightness(0)_saturate(100%)_invert(45%)_sepia(93%)_saturate(6494%)_hue-rotate(246deg)_brightness(102%)_contrast(101%)]"
              />
            </motion.a>
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="relative z-10 pb-8 text-center text-sm text-muted-foreground"
      >
        <p>© 2025 Lumenless. All rights reserved.</p>
      </motion.footer>
    </div>
  );
}
