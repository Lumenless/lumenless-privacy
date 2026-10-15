# Lumenless — paid tweets and threads

The current web product lets users submit text, photos or an MP4 video for publication on **@lumenless**. A tweet costs **1M LUMEN**; a thread of up to five tweets costs **3M LUMEN**. SOL checkout swaps through Jupiter before paying in LUMEN. Paid orders enter the admin queue, trigger a Telegram notification, and publish through X API after approval. Administrators can reject with or without a LUMEN refund. Email and Telegram contacts are optional.

Run the Next.js application from `web/`. See [tweet order setup](web/TWEET_ORDERS_SETUP.md) for the database bootstrap, environment variables, X connection and payment recovery. The implementation is local; live checkout requires integration credentials and verification before deployment.

```sh
cd web
npm install
npm run dev
npm run test:tweet-orders
```

The `mobile/` application and legacy privacy integrations have not been migrated. The mobile app currently contains Expo. The legacy `/sns` route is disabled because it referenced public private-key environment variables.

---

The documentation below describes the previous privacy product.

# Light 2.0 🔒

Building The Future Of Privacy On Solana. Private payments. Private trading. Private [redacted].

A modern web application featuring a beautiful waitlist landing page and a private payments demo built with Next.js, Solana, and Arcium encryption.

![Next.js](https://img.shields.io/badge/Next.js-15-black)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8)

## ✨ Features

### 🌟 Waitlist Landing Page
- 🎨 **Beautiful UI** - Modern, clean design with gradient backgrounds and smooth animations
- 🎭 **Smooth Animations** - Engaging animations powered by Framer Motion
- 📧 **Email Collection** - Secure email storage with Supabase
- ✅ **Validation** - Email validation and duplicate checking
- 📱 **Responsive** - Works perfectly on all devices
- ⚡ **Fast** - Built with Next.js 15 and Turbopack

### 🔒 Private Payments Demo
- 💰 **Solana Wallet Integration** - Support for Phantom, Backpack, and Solflare wallets
- 🔐 **Arcium Encryption** - Private payment encryption using Arcium's MXE (Multiparty Execution Environment)
- 💸 **Send SOL** - Send Solana tokens on devnet
- 📊 **Balance Management** - View balance, deposit, and withdraw functionality
- 🎯 **Devnet Support** - Fully configured for Solana devnet testing

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- A Supabase account (free tier works great!)
- A Solana wallet extension (Phantom, Backpack, or Solflare)

### 1. Clone and Install

```bash
npm install
```

### 2. Set Up Supabase

Follow the detailed instructions in [SETUP.md](./SETUP.md) to:
- Create a Supabase project
- Set up the waitlist table
- Configure environment variables

Or quickly run:

```bash
# Create .env.local file
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 3. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see your application!

## 📁 Project Structure

```
src/
├── app/
│   ├── api/
│   │   └── waitlist/
│   │       └── route.ts           # API endpoint for waitlist
│   ├── demo/
│   │   └── page.tsx               # Private payments demo page
│   ├── layout.tsx                 # Root layout with metadata
│   ├── page.tsx                   # Main waitlist landing page
│   └── globals.css                # Global styles
├── components/
│   ├── ui/                        # Shadcn UI components
│   ├── DepositModal.tsx           # Deposit SOL modal
│   ├── PrivatePaymentForm.tsx     # Private payment form component
│   ├── ProfilePopup.tsx           # User profile popup
│   ├── SimpleWalletButton.tsx     # Wallet connection button
│   ├── WalletConnection.tsx       # Wallet connection component
│   ├── WalletStatus.tsx           # Wallet status display
│   ├── WaitlistForm.tsx           # Waitlist form component
│   └── WithdrawModal.tsx          # Withdraw SOL modal
├── hooks/                         # Custom React hooks
└── lib/
    ├── arcium-browser.ts          # Arcium client (browser-compatible)
    ├── arcium-real-payment.ts     # Real Arcium payment implementation
    ├── arcium-simple.ts           # Simplified Arcium client
    ├── arcium.ts                  # Full Arcium client
    ├── real-solana-payment.ts     # Standard Solana payment client
    ├── supabase.ts                # Supabase client
    └── utils.ts                   # Utility functions
```

## 🛠️ Tech Stack

### Core
- **Framework:** [Next.js 15](https://nextjs.org) with Turbopack
- **Language:** [TypeScript](https://www.typescriptlang.org)
- **Styling:** [Tailwind CSS 4](https://tailwindcss.com)
- **UI Components:** [shadcn/ui](https://ui.shadcn.com)
- **Animations:** [Framer Motion](https://www.framer.com/motion)

### Blockchain & Privacy
- **Blockchain:** [Solana](https://solana.com) (Devnet)
- **Wallet Adapter:** [@solana/wallet-adapter-react](https://github.com/solana-labs/wallet-adapter)
- **Encryption:** [Arcium](https://arcium.com) - Private computation on Solana
- **Web3:** [@solana/web3.js](https://solana-labs.github.io/solana-web3.js/)

### Backend & Database
- **Database:** [Supabase](https://supabase.com)
- **Validation:** [Zod](https://zod.dev)

## 💻 Available Scripts

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linting
npm run lint
```

## 🔐 Solana Wallet Setup

### Supported Wallets
- **Phantom** - [Download](https://phantom.app)
- **Backpack** - [Download](https://www.backpack.app)
- **Solflare** - [Download](https://solflare.com)

### Getting Test SOL

Since this app runs on Solana devnet, you'll need devnet SOL:

1. Connect your wallet to devnet
2. Visit [Solana Faucet](https://faucet.solana.com)
3. Enter your wallet address and request test SOL

## 🎨 Key Features Explained

### Private Payments

Light 2.0 uses Arcium's encryption technology to enable private payments on Solana:

1. **Encryption**: Payment data is encrypted using Arcium's x25519 key exchange and Rescue cipher
2. **MXE Integration**: Uses Multiparty Execution Environment for secure computation
3. **Privacy**: Transaction details remain private while executing on-chain

### Wallet Integration

The app seamlessly integrates with Solana wallets:
- Auto-connect support
- Multiple wallet options
- Real-time balance updates
- Transaction signing and confirmation

## 📝 Environment Variables

Create a `.env.local` file with:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# Optional: Custom RPC endpoint
# NEXT_PUBLIC_SOLANA_RPC_URL=your-custom-rpc-url
```

## 🚀 Deployment

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Push your code to GitHub
2. Import repository on Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

### Environment Variables in Production

Make sure to add all environment variables in your deployment platform:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 🧪 Testing Private Payments

1. Navigate to `/demo` or click "Try Private Payments Demo" on the homepage
2. Connect your Solana wallet (Phantom, Backpack, or Solflare)
3. Ensure you have devnet SOL (get from [faucet](https://faucet.solana.com))
4. Enter recipient address and amount
5. Send private payment!

## 📊 Viewing Waitlist Data

Access your waitlist data in the Supabase dashboard:

1. Go to your project dashboard
2. Navigate to "Table Editor"
3. Select the "waitlist" table
4. View all signups

## 🔧 Customization

### Change Branding
- Update the title in `src/app/page.tsx`
- Modify metadata in `src/app/layout.tsx`
- Adjust colors in `src/app/globals.css`

### Modify Animations
- Edit animation settings in `src/components/WaitlistForm.tsx`
- Adjust background effects in `src/app/page.tsx`

### Configure Arcium
- Update Arcium client settings in `src/lib/arcium*.ts`
- Replace placeholder program IDs with actual Arcium program IDs
- Configure MXE addresses for production

## 📖 Documentation

- **Setup Guide:** See [SETUP.md](./SETUP.md) for detailed setup instructions
- **Notifications:** See [NOTIFICATIONS_SETUP.md](./NOTIFICATIONS_SETUP.md) for notification configuration

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Open issues for bugs or feature requests
- Submit pull requests with improvements
- Share feedback and suggestions

## ⚠️ Important Notes

### Development Status
- This application is currently configured for **Solana Devnet**
- Arcium integration uses placeholder program IDs (replace for production)
- Some features are simulated for demonstration purposes

### Production Readiness
Before deploying to production:
1. Replace placeholder Arcium program IDs with actual deployed program IDs
2. Configure real MXE addresses from Arcium network
3. Set up proper error handling and monitoring
4. Update RPC endpoints to mainnet
5. Implement proper security measures

## 📄 License

MIT License - feel free to use this for your own projects!

## 🔗 Links

- **Website:** [Light.app](https://light.app)
- **Twitter:** [@lightdotapp](https://x.com/lightdotapp)
- **Discord:** [Join our community](https://discord.gg/Dn7YQjKY9h)

---

Built with ❤️ using Next.js, Solana, and Arcium
