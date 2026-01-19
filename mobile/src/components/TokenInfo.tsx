import { View, Text, StyleSheet, Animated, TouchableOpacity, Linking } from 'react-native';
import { useEffect, useRef } from 'react';
import { useTokenOverview } from '../hooks/useTokenData';
import { Logo } from './index';
import { LUMEN_TOKEN } from '../services/birdeye';

const JUPITER_URL = `https://jup.ag/swap/SOL-${LUMEN_TOKEN.address}`;
const PUMPFUN_URL = `https://pump.fun/coin/${LUMEN_TOKEN.address}`;

// Skeleton shimmer component
function SkeletonBox({ width, height, style }: { width: number | string; height: number; style?: any }) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.6],
  });

  return (
    <Animated.View
      style={[
        { width, height, backgroundColor: '#222', borderRadius: 12, opacity },
        style,
      ]}
    />
  );
}

export default function TokenInfo() {
  const { overview, loading } = useTokenOverview();

  const formatPrice = (price: number) => {
    if (price < 0.0001) return `$${price.toExponential(2)}`;
    if (price < 0.01) return `$${price.toFixed(6)}`;
    if (price < 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(2)}`;
  };

  const formatLargeNumber = (num: number) => {
    if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  };

  const priceChange = overview?.priceChange24hPercent || 0;
  const isPositive = priceChange >= 0;

  return (
    <View style={styles.container}>
      {/* Main Card */}
      <View style={styles.mainCard}>
        {/* Token Header with Logo */}
        <View style={styles.tokenHeader}>
          <View style={styles.logoContainer}>
            <Logo size={56} color="#8000FF" />
          </View>
          <View style={styles.tokenInfo}>
            <Text style={styles.tokenName}>LUMEN</Text>
            <Text style={styles.tokenTicker}>$LUMEN</Text>
          </View>
        </View>

        {/* Price Section */}
        <View style={styles.priceSection}>
          {loading && !overview ? (
            <SkeletonBox width={180} height={52} />
          ) : (
            <Text style={styles.price}>
              {overview?.price ? formatPrice(overview.price) : '--'}
            </Text>
          )}
          
          {loading && !overview ? (
            <SkeletonBox width={90} height={36} style={{ borderRadius: 12, marginTop: 12 }} />
          ) : (
            <View style={[styles.changeBadge, isPositive ? styles.positive : styles.negative]}>
              <Text style={[styles.changeIcon]}>
                {isPositive ? '↑' : '↓'}
              </Text>
              <Text style={[styles.changeText, isPositive ? styles.positiveText : styles.negativeText]}>
                {Math.abs(priceChange).toFixed(2)}%
              </Text>
              <Text style={styles.changeLabel}>24h</Text>
            </View>
          )}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Market Cap</Text>
            {loading && !overview ? (
              <SkeletonBox width={80} height={24} style={{ marginTop: 4 }} />
            ) : (
              <Text style={styles.statValue}>
                {overview?.marketCap ? formatLargeNumber(overview.marketCap) : '--'}
              </Text>
            )}
          </View>

          <View style={styles.statDivider} />

          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Liquidity</Text>
            {loading && !overview ? (
              <SkeletonBox width={80} height={24} style={{ marginTop: 4 }} />
            ) : (
              <Text style={styles.statValue}>
                {overview?.liquidity ? formatLargeNumber(overview.liquidity) : '--'}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Buy Buttons */}
      <View style={styles.buyButtons}>
        <TouchableOpacity
          style={styles.buyButtonPrimary}
          onPress={() => Linking.openURL(JUPITER_URL)}
          activeOpacity={0.8}
        >
          <Text style={styles.buyButtonText}>Buy on Jupiter</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.buyButtonSecondary}
          onPress={() => Linking.openURL(PUMPFUN_URL)}
          activeOpacity={0.8}
        >
          <Text style={styles.buyButtonSecondaryText}>Buy on Pump.fun</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  mainCard: {
    width: '100%',
    backgroundColor: '#0D0D0D',
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(128, 0, 255, 0.2)',
    shadowColor: '#8000FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  tokenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(128, 0, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tokenInfo: {
    marginLeft: 16,
  },
  tokenName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  tokenTicker: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
    fontWeight: '500',
  },
  priceSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  price: {
    fontSize: 48,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -2,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    marginTop: 12,
    gap: 6,
  },
  positive: {
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
  },
  negative: {
    backgroundColor: 'rgba(255, 82, 82, 0.12)',
  },
  changeIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: '#00E676',
  },
  changeText: {
    fontSize: 18,
    fontWeight: '700',
  },
  positiveText: {
    color: '#00E676',
  },
  negativeText: {
    color: '#FF5252',
  },
  changeLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
    marginLeft: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginTop: 6,
  },
  buyButtons: {
    width: '100%',
    marginTop: 20,
    gap: 12,
  },
  buyButtonPrimary: {
    backgroundColor: '#8000FF',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#8000FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  buyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  buyButtonSecondary: {
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(128, 0, 255, 0.4)',
  },
  buyButtonSecondaryText: {
    color: '#8000FF',
    fontSize: 15,
    fontWeight: '600',
  },
});
