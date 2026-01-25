import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { PayLinkModal, CreatePayLinkModal } from '../components';
import { createPayLink, getPayLinks, getPayLinkUrl, PayLink } from '../services/paylink';
import { usePayLinkBalances } from '../hooks/usePayLinkBalances';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../navigation/AppNavigator';
import { testNetworkConnectivity, testRpcEndpoint } from '../services/balances';
import { SOLANA_RPC_URL, FALLBACK_RPC_URL } from '../constants/solana';

type NavigationProp = StackNavigationProp<RootStackParamList>;

export default function PayLinksScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const [payLinks, setPayLinks] = useState<PayLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [newLinkPublicKey, setNewLinkPublicKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadPayLinks = useCallback(async () => {
    setLoading(true);
    const links = await getPayLinks();
    setPayLinks(links);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPayLinks();
      
      // Test network connectivity on mount (for debugging)
      if (__DEV__) {
        testNetworkConnectivity().then((ok) => {
          console.log(`[PayLinksScreen] Network connectivity: ${ok ? 'OK' : 'FAILED'}`);
          if (!ok) {
            console.warn('[PayLinksScreen] ⚠️ Network connectivity test failed! Check Android emulator network settings.');
          }
        });
        
        testRpcEndpoint(SOLANA_RPC_URL).then((ok) => {
          console.log(`[PayLinksScreen] Primary RPC endpoint: ${ok ? 'OK' : 'FAILED'}`);
        });
        
        testRpcEndpoint(FALLBACK_RPC_URL).then((ok) => {
          console.log(`[PayLinksScreen] Fallback RPC endpoint: ${ok ? 'OK' : 'FAILED'}`);
        });
      }
    }, [loadPayLinks])
  );

  const { balances, refresh: refreshBalances } = usePayLinkBalances(payLinks);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Refresh both pay links and balances
      await loadPayLinks();
      await refreshBalances();
    } finally {
      setRefreshing(false);
    }
  }, [loadPayLinks, refreshBalances]);

  const handleOpenCreateModal = () => setCreateModalVisible(true);

  const handleCreateWithTitle = async (title?: string) => {
    setCreating(true);
    try {
      const link = await createPayLink(title);
      setNewLinkPublicKey(link.publicKey);
      setCreateModalVisible(false);
      setSuccessModalVisible(true);
      await loadPayLinks();
    } catch (error) {
      console.error('Error creating pay link:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = async (publicKey: string, id: string) => {
    const url = getPayLinkUrl(publicKey);
    await Clipboard.setStringAsync(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const truncateKey = (key: string) => {
    if (key.length <= 14) return key;
    return `${key.slice(0, 7)}...${key.slice(-5)}`;
  };

  const formatBalance = (amount: number): string => {
    if (amount === 0) return '';
    if (amount < 0.0001) return amount.toExponential(2);
    if (amount < 0.01) return amount.toFixed(4);
    if (amount < 1) return amount.toFixed(2);
    if (amount < 1000) return amount.toFixed(2);
    return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  const CreateButton = ({ noTopMargin }: { noTopMargin?: boolean }) => (
    <Pressable
      style={({ pressed }) => [
        styles.createBtn,
        noTopMargin && styles.createBtnNoMargin,
        pressed && styles.createBtnPressed,
      ]}
      onPress={handleOpenCreateModal}
    >
      <Text style={styles.createBtnIcon}>+</Text>
      <Text style={styles.createBtnLabel}>Create pay link</Text>
    </Pressable>
  );

  const renderPayLink = ({ item }: { item: PayLink }) => {
    const isCopied = copiedId === item.id;
    const primary = item.label?.trim() || truncateKey(item.publicKey);
    const walletBalances = balances[item.publicKey];
    
    // Debug logging
    if (walletBalances) {
      console.log(`[Balance] ${item.publicKey.slice(0, 8)}: SOL=${walletBalances.sol}, USDC=${walletBalances.usdc}`);
    }
    
    // Use >= 0.000001 to handle very small balances and floating point precision
    const hasSol = walletBalances && walletBalances.sol >= 0.000001;
    const hasUsdc = walletBalances && walletBalances.usdc >= 0.000001;
    const hasBalances = hasSol || hasUsdc;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          pressed && styles.cardPressed,
        ]}
        onPress={() => navigation.navigate('PayLinkDetails', { payLink: item })}
      >
        <View style={styles.cardLeft}>
          <View style={styles.cardDot} />
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {primary}
            </Text>
            <Text style={styles.cardMeta}>{formatDate(item.createdAt)}</Text>
            {hasBalances && (
              <View style={styles.balances}>
                {hasSol && (
                  <View style={styles.balanceBadge}>
                    <Text style={styles.balanceText}>
                      {formatBalance(walletBalances!.sol)} SOL
                    </Text>
                  </View>
                )}
                {hasUsdc && (
                  <View style={styles.balanceBadge}>
                    <Text style={styles.balanceText}>
                      {formatBalance(walletBalances!.usdc)} USDC
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.copyBtn,
            isCopied && styles.copyBtnSuccess,
            pressed && styles.copyBtnPressed,
          ]}
          onPress={(e) => {
            e.stopPropagation();
            handleCopyLink(item.publicKey, item.id);
          }}
        >
          <Text style={[styles.copyBtnText, isCopied && styles.copyBtnTextSuccess]}>
            {isCopied ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>
      </Pressable>
    );
  };

  const renderEmpty = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <View style={styles.emptyIconLine} />
        <View style={[styles.emptyIconLine, styles.emptyIconLineShort]} />
        <View style={styles.emptyIconLine} />
      </View>
      <Text style={styles.emptyTitle}>No pay links yet</Text>
      <Text style={styles.emptyDesc}>
        Create a link to receive payments. Share it with anyone—they pay, you receive.
      </Text>
      <CreateButton />
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Lumenless</Text>
        <Text style={styles.subtitle}>Receive payments privately</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={payLinks}
          keyExtractor={(item) => item.id}
          renderItem={renderPayLink}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            payLinks.length > 0 ? (
              <View style={styles.footer}>
                <CreateButton noTopMargin />
              </View>
            ) : null
          }
          contentContainerStyle={[styles.list, payLinks.length === 0 && styles.listEmpty]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        />
      )}

      <CreatePayLinkModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreate={handleCreateWithTitle}
        creating={creating}
      />
      <PayLinkModal
        visible={successModalVisible}
        publicKey={newLinkPublicKey}
        onClose={() => setSuccessModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
  },
  header: {
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.title,
    color: colors.text,
    fontSize: 26,
  },
  subtitle: {
    ...typography.subtitle,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingBottom: spacing.xl,
  },
  listEmpty: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emptyIconWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: spacing.xl,
  },
  emptyIconLine: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHover,
  },
  emptyIconLineShort: {
    width: 20,
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyDesc: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.xl,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: radius.full,
    gap: 8,
    marginTop: spacing.xl,
    alignSelf: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  createBtnNoMargin: {
    marginTop: 0,
  },
  createBtnPressed: {
    opacity: 0.9,
  },
  createBtnIcon: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '400',
  },
  createBtnLabel: {
    ...typography.button,
    color: '#fff',
  },
  footer: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardPressed: {
    opacity: 0.8,
  },
  cardLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 0,
  },
  cardDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    ...typography.mono,
    color: colors.text,
    fontSize: 14,
  },
  cardMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  balances: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  balanceBadge: {
    backgroundColor: colors.accentDim,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  balanceText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.accent,
    fontWeight: '600',
  },
  copyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    backgroundColor: colors.accentDim,
    marginLeft: spacing.md,
  },
  copyBtnSuccess: {
    backgroundColor: colors.successDim,
  },
  copyBtnPressed: {
    opacity: 0.8,
  },
  copyBtnText: {
    ...typography.caption,
    color: colors.accent,
    fontSize: 13,
  },
  copyBtnTextSuccess: {
    color: colors.success,
  },
});
