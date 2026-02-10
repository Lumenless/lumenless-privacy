import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useRef, useEffect } from 'react';
import { colors, spacing, radius, typography } from '../theme';
import { mintLumenId, checkLumenIdMintBalance } from '../services/lumenid';
import { logScreenView, logEvent, analyticsEvents } from '../services/firebase';
import { base64AddressToBase58 } from '../services/transfer';
import { getWalletErrorMessage } from '../utils/walletErrors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SLIDES = [
  {
    title: 'Receive payments privately',
    description: 'Create payment links and receive SOL or USDC without exposing your main wallet.',
  },
  {
    title: 'Your keys, your control',
    description: 'Each invoice has its own wallet. Backup your keys and withdraw when you want.',
  },
  {
    title: 'Mint your Lumen ID',
    description: 'It\'s your unique identity. You\'ll need it to use the app.',
  },
];

interface OnboardingScreenProps {
  onSuccess: () => void;
}

export default function OnboardingScreen({ onSuccess }: OnboardingScreenProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    logScreenView('Onboarding', 'OnboardingScreen');
  }, []);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (index !== currentIndex) setCurrentIndex(index);
  };

  const handleNext = () => {
    const nextIndex = Math.min(currentIndex + 1, SLIDES.length - 1);
    scrollRef.current?.scrollTo({
      x: nextIndex * SCREEN_WIDTH,
      animated: true,
    });
  };

  const handleMintLumenId = async () => {
    setMinting(true);
    setMintError(null);
    try {
      const mwa = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
      const { VersionedTransaction } = await import('@solana/web3.js');

      await mwa.transact(async (wallet) => {
        const authResult = await wallet.authorize({
          cluster: 'mainnet-beta',
          identity: { name: 'Lumenless', uri: 'https://lumenless.com', icon: 'icon.png' },
        });
        const base64Address = authResult.accounts[0].address;
        const userAddressBase58 = base64AddressToBase58(base64Address);

        const balanceCheck = await checkLumenIdMintBalance(userAddressBase58);
        if (!balanceCheck.sufficient && balanceCheck.errorMessage) {
          setMintError(balanceCheck.errorMessage);
          return;
        }

        const signTransaction = async (tx: Uint8Array): Promise<Uint8Array> => {
          const versionedTx = VersionedTransaction.deserialize(tx);
          const [signedTx] = await wallet.signTransactions({
            transactions: [versionedTx],
          });
          return new Uint8Array(signedTx.serialize());
        };

        const result = await mintLumenId(userAddressBase58, signTransaction);

        if (result.success) {
          logEvent(analyticsEvents.onboardingComplete, {});
          logEvent(analyticsEvents.walletConnect, { source: 'onboarding_mint' });
          onSuccess();
        } else {
          setMintError(
            getWalletErrorMessage(
              result.error != null ? new Error(result.error) : null,
              result.error ?? 'Mint failed'
            )
          );
        }
      });
    } catch (err: unknown) {
      setMintError(getWalletErrorMessage(err, 'Could not complete mint. Please try again.'));
    } finally {
      setMinting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scrollView}
      >
        {SLIDES.map((slide, index) => (
          <View key={index} style={[styles.slide, { width: SCREEN_WIDTH }]}>
            <View style={styles.slideContent}>
              <View style={styles.iconWrap}>
                <Text style={styles.iconText}>{index + 1}</Text>
              </View>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.description}>{slide.description}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, index) => (
            <View
              key={index}
              style={[styles.dot, index === currentIndex && styles.dotActive]}
            />
          ))}
        </View>

        {currentIndex === SLIDES.length - 1 ? (
          <>
            {mintError ? (
              <Text style={styles.mintError}>{mintError}</Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.startBtn,
                (minting || pressed) && styles.startBtnPressed,
              ]}
              onPress={handleMintLumenId}
              disabled={minting}
            >
              {minting ? (
                <ActivityIndicator size="small" color="#5b21b6" />
              ) : (
                <Text style={styles.startBtnLabel}>MINT LUMEN ID</Text>
              )}
            </Pressable>
          </>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.nextBtn, pressed && styles.nextBtnPressed]}
            onPress={handleNext}
          >
            <Text style={styles.nextBtnLabel}>Next</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#5b21b6',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    height: '100%',
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  slideContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  iconText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
  },
  title: {
    ...typography.title,
    fontSize: 26,
    color: '#fff',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  description: {
    ...typography.body,
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    lineHeight: 24,
  },
  footer: {
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 24,
  },
  startBtn: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: radius.md,
    minWidth: 200,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  startBtnPressed: {
    opacity: 0.9,
  },
  startBtnLabel: {
    ...typography.button,
    fontSize: 17,
    color: '#5b21b6',
  },
  nextBtn: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: radius.md,
    minWidth: 200,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  nextBtnPressed: {
    opacity: 0.9,
  },
  nextBtnLabel: {
    ...typography.button,
    fontSize: 17,
    color: '#5b21b6',
  },
  mintError: {
    ...typography.caption,
    color: colors.error,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
});
