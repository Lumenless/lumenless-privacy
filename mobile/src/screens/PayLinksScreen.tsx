import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { PayLinkModal, CreatePayLinkModal } from '../components';
import { createPayLink, getPayLinks, getPayLinkUrl, getHiddenPayLinksCount, PayLink } from '../services/paylink';
import { usePayLinkBalances } from '../hooks/usePayLinkBalances';
import * as Clipboard from 'expo-clipboard';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../navigation/AppNavigator';
import { logScreenView, logEvent, analyticsEvents } from '../services/firebase';
import { testNetworkConnectivity } from '../services/balances';
import {
  getPrivacyCashBalance,
  getPrivacyCashBalanceWithSignature,
  withdrawFromPrivacyCash,
  PrivacyCashBalances,
  WithdrawResult,
  TokenKind,
  PRIVACYCASH_TOKEN_LABELS,
} from '../services/privacycash';
import { isValidSolanaAddress, base64AddressToBase58 } from '../services/transfer';
import { getWalletErrorMessage } from '../utils/walletErrors';
import { VersionedTransaction } from '@solana/web3.js';

type NavigationProp = StackNavigationProp<RootStackParamList>;

const PC_TOKENS: TokenKind[] = ['SOL', 'USDC', 'USDT'];

export default function PayLinksScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const [payLinks, setPayLinks] = useState<PayLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [newLinkPublicKey, setNewLinkPublicKey] = useState<string | null>(null);
  const [newLinkId, setNewLinkId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showingHidden, setShowingHidden] = useState(false);

  // Private wallet (PrivacyCash) state
  const [pcBalance, setPcBalance] = useState<PrivacyCashBalances | null>(null);
  const [pcUserAddress, setPcUserAddress] = useState<string | null>(null);
  const [pcLoading, setPcLoading] = useState(false);
  const [pcError, setPcError] = useState<string | null>(null);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [withdrawToken, setWithdrawToken] = useState<TokenKind>('SOL');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const connectDoneRef = useRef(false);
  // Store the signed message for refreshing balance without re-authorizing
  const [pcSignature, setPcSignature] = useState<string | null>(null);

  const loadPayLinks = useCallback(async () => {
    setLoading(true);
    const links = await getPayLinks(showingHidden);
    setPayLinks(links);
    
    // Get hidden count
    const count = await getHiddenPayLinksCount();
    setHiddenCount(count);
    
    setLoading(false);
  }, [showingHidden]);

  useFocusEffect(
    useCallback(() => {
      logScreenView('PayLinks', 'PayLinksScreen');
      loadPayLinks();

      // Test network connectivity on mount (for debugging)
      if (__DEV__) {
        testNetworkConnectivity().then((ok) => {
          console.log(`[PayLinksScreen] Network connectivity: ${ok ? 'OK' : 'FAILED'}`);
          if (!ok) {
            console.warn('[PayLinksScreen] ⚠️ Network connectivity test failed! Check Android emulator network settings.');
          }
        });
      }
    }, [loadPayLinks])
  );

  // Reload links when showingHidden changes
  useEffect(() => {
    loadPayLinks();
  }, [showingHidden, loadPayLinks]);

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

  const handleToggleHidden = useCallback(async () => {
    setShowingHidden(!showingHidden);
  }, [showingHidden]);

  const handleConnectAndLoadBalance = useCallback(async () => {
    console.log('[PayLinksScreen] Connect wallet: start');
    setPcLoading(true);
    setPcError(null);
    connectDoneRef.current = false;
    
    // Keep screen awake during balance fetch (fire-and-forget, don't block)
    activateKeepAwakeAsync('privacycash-balance').catch(() => {});
    
    const SAFETY_TIMEOUT_MS = 90000; // Extended to 90s since balance fetch can be slow
    const safetyTimer = setTimeout(() => {
      if (!connectDoneRef.current) {
        console.log('[PayLinksScreen] Connect wallet: safety timeout fired');
        setPcError('Request timed out. Try again.');
        setPcLoading(false);
        deactivateKeepAwake('privacycash-balance');
      }
    }, SAFETY_TIMEOUT_MS);
    try {
      console.log('[PayLinksScreen] Connect wallet: loading MWA...');
      const mwa = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
      const { Buffer } = await import('buffer');
      console.log('[PayLinksScreen] Connect wallet: starting transact (authorize + balance)...');
      await mwa.transact(async (wallet) => {
        console.log('[PayLinksScreen] Connect wallet: calling wallet.authorize...');
        const authResult = await wallet.authorize({
          cluster: 'mainnet-beta',
          identity: { name: 'Lumenless', uri: 'https://lumenless.com', icon: 'icon.png' },
        });
        const base64Address = authResult.accounts[0].address;
        const userPublicKey = base64AddressToBase58(base64Address);
        console.log('[PayLinksScreen] Connect wallet: authorized, address:', userPublicKey);
        setPcUserAddress(userPublicKey);
        
        // Sign and save signature for future balance refreshes
        const signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
          const result = await wallet.signMessages({ addresses: [base64Address], payloads: [message] });
          const sig = result[0];
          // Save signature as base64 for reuse
          const sigBase64 = Buffer.from(sig).toString('base64');
          setPcSignature(sigBase64);
          return sig;
        };
        console.log('[PayLinksScreen] Connect wallet: fetching PrivacyCash balance...');
        const balances = await getPrivacyCashBalance(userPublicKey, signMessage, null);
        console.log('[PayLinksScreen] Connect wallet: balance received', { sol: balances.sol, usdc: balances.usdc, usdt: balances.usdt });
        setPcBalance(balances);
        logEvent(analyticsEvents.walletConnect, { source: 'pay_links_private_wallet' });
      });
      console.log('[PayLinksScreen] Connect wallet: transact finished');
    } catch (err: unknown) {
      console.error('[PayLinksScreen] Connect wallet: error', err);
      setPcError(getWalletErrorMessage(err, 'Could not load balance. Connect your wallet and try again.'));
      setPcBalance(null);
      setPcUserAddress(null);
      setPcSignature(null);
    } finally {
      connectDoneRef.current = true;
      clearTimeout(safetyTimer);
      setPcLoading(false);
      deactivateKeepAwake('privacycash-balance');
      console.log('[PayLinksScreen] Connect wallet: done (finally)');
    }
  }, []);

  // Refresh balance using saved signature (no wallet authorization needed)
  const refreshPcBalance = useCallback(async () => {
    if (!pcUserAddress || !pcSignature) {
      console.log('[PayLinksScreen] refreshPcBalance: no saved credentials, skipping');
      return;
    }
    console.log('[PayLinksScreen] refreshPcBalance: refreshing with saved signature...');
    setPcLoading(true);
    setPcError(null);
    try {
      const balances = await getPrivacyCashBalanceWithSignature(pcUserAddress, pcSignature);
      console.log('[PayLinksScreen] refreshPcBalance: done', { sol: balances.sol, usdc: balances.usdc, usdt: balances.usdt });
      setPcBalance(balances);
    } catch (err) {
      console.error('[PayLinksScreen] refreshPcBalance: error', err);
      // Don't clear the balance on error - keep showing old balance
      setPcError('Could not refresh balance');
    } finally {
      setPcLoading(false);
    }
  }, [pcUserAddress, pcSignature]);

  // Auto-refresh balance when returning from WebView withdraw (if we have saved credentials)
  useFocusEffect(
    useCallback(() => {
      // Only refresh if we already have a connected wallet with saved signature
      if (pcUserAddress && pcSignature) {
        refreshPcBalance();
      }
    }, [pcUserAddress, pcSignature, refreshPcBalance])
  );

  const openWithdrawModal = useCallback((token: TokenKind) => {
    setWithdrawToken(token);
    setWithdrawAddress('');
    setWithdrawAmount('');
    setWithdrawError('');
    setWithdrawModalVisible(true);
  }, []);

  // Open WebView-based withdraw (faster - runs ZK proof in browser)
  const openWebViewWithdraw = useCallback((token?: TokenKind) => {
    navigation.navigate('WebViewWithdraw', {
      token: token || 'SOL',
      walletAddress: pcUserAddress || undefined,
      // Pass balances in BASE UNITS (lamports for SOL, 1e6 for USDC/USDT)
      // pcBalance stores human-readable values, so we convert back
      balances: pcBalance ? {
        SOL: Math.round(pcBalance.sol * 1e9),   // Convert SOL to lamports
        USDC: Math.round(pcBalance.usdc * 1e6), // Convert to USDC base units
        USDT: Math.round(pcBalance.usdt * 1e6), // Convert to USDT base units
      } : undefined,
    });
    // Note: Balance will refresh automatically when screen focuses
  }, [navigation, pcUserAddress, pcBalance]);

  const handleWithdraw = useCallback(async () => {
    const address = withdrawAddress.trim();
    const amountStr = withdrawAmount.trim();
    if (!address) {
      setWithdrawError('Enter destination wallet address');
      return;
    }
    if (!isValidSolanaAddress(address)) {
      setWithdrawError('Invalid Solana wallet address');
      return;
    }
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      setWithdrawError('Enter a valid amount');
      return;
    }
    const bal = pcBalance ?? { sol: 0, usdc: 0, usdt: 0 };
    const maxAmount = withdrawToken === 'SOL' ? bal.sol : withdrawToken === 'USDC' ? bal.usdc : bal.usdt;
    if (amount > maxAmount) {
      setWithdrawError(`Insufficient balance (max ${maxAmount})`);
      return;
    }
    setWithdrawing(true);
    setWithdrawError('');
    try {
      const mwaWithdraw = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
      await mwaWithdraw.transact(async (wallet) => {
        const authResult = await wallet.authorize({
          cluster: 'mainnet-beta',
          identity: { name: 'Lumenless', uri: 'https://lumenless.com', icon: 'icon.png' },
        });
        const base64Address = authResult.accounts[0].address;
        const userPublicKey = base64AddressToBase58(base64Address);
        const signMessage = async (msg: Uint8Array) => {
          const r = await wallet.signMessages({ addresses: [base64Address], payloads: [msg] });
          return r[0];
        };
        const signTransaction = async (tx: Uint8Array) => {
          const versionedTx = VersionedTransaction.deserialize(tx);
          const [signedTx] = await wallet.signTransactions({ transactions: [versionedTx] });
          return new Uint8Array(signedTx.serialize());
        };
        const result: WithdrawResult = await withdrawFromPrivacyCash(
          withdrawToken,
          amount,
          address,
          userPublicKey,
          signMessage,
          signTransaction,
          null
        );
        if (result.success) {
          logEvent(analyticsEvents.withdraw, { token: withdrawToken, amount });
          setWithdrawModalVisible(false);
          Alert.alert('Withdrawal successful', result.tx ? `Tx: ${result.tx}` : 'Done.', [{ text: 'OK' }]);
          setPcBalance((prev) =>
            prev
              ? {
                  ...prev,
                  [withdrawToken === 'SOL' ? 'sol' : withdrawToken === 'USDC' ? 'usdc' : 'usdt']: Math.max(
                    0,
                    (prev[withdrawToken === 'SOL' ? 'sol' : withdrawToken === 'USDC' ? 'usdc' : 'usdt'] - amount)
                  ),
                }
              : null
          );
        } else {
          setWithdrawError(result.error ?? 'Withdrawal failed');
        }
      });
    } catch (err: unknown) {
      setWithdrawError(getWalletErrorMessage(err, 'Withdrawal failed. Please try again.'));
    } finally {
      setWithdrawing(false);
    }
  }, [pcBalance, withdrawAddress, withdrawAmount, withdrawToken]);

  const formatPcBalance = (value: number): string => {
    if (value === 0) return '0';
    if (value < 0.0001) return value.toExponential(2);
    if (value < 1) return value.toFixed(4);
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  const handleOpenCreateModal = () => setCreateModalVisible(true);

  const handleCreateWithTitle = async (title?: string) => {
    setCreating(true);
    try {
      const link = await createPayLink(title);
      logEvent(analyticsEvents.createInvoice, { pay_link_id: link.id });
      setNewLinkPublicKey(link.publicKey);
      setNewLinkId(link.id);
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
      <Text style={styles.createBtnLabel}>Create invoice</Text>
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
      <Text style={styles.emptyTitle}>No invoices yet</Text>
      <Text style={styles.emptyDesc}>
        Create a link to receive payments. Share it with anyone—they pay, you receive.
      </Text>
      <CreateButton />
    </View>
  );

  const listHeader = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>Lumenless</Text>
        <Text style={styles.subtitle}>Receive payments privately</Text>
      </View>

      {/* Private wallet — compact single-row card */}
      <View style={styles.privateWalletCard}>
        <View style={styles.privateWalletLeft}>
          <Text style={styles.privateWalletTitle}>Private wallet</Text>
          {pcUserAddress ? (
            <Text style={styles.privateWalletBalancesCompact} numberOfLines={1}>
              {PC_TOKENS.map((token) => {
                const val = pcBalance
                  ? pcBalance[token === 'SOL' ? 'sol' : token === 'USDC' ? 'usdc' : 'usdt']
                  : 0;
                return `${PRIVACYCASH_TOKEN_LABELS[token]} ${formatPcBalance(val)}`;
              }).join(' · ')}
            </Text>
          ) : (
            <Text style={styles.privateWalletDesc}>
              Connect your Solana wallet to view and withdraw.
            </Text>
          )}
        </View>
        <View style={styles.privateWalletRight}>
          {!pcUserAddress ? (
            <>
              {pcError ? <Text style={styles.pcErrorTextCard}>{pcError}</Text> : null}
              <Pressable
                style={({ pressed }) => [styles.monoBtn, styles.monoBtnCompact, pressed && styles.monoBtnPressed]}
                onPress={handleConnectAndLoadBalance}
                disabled={pcLoading}
              >
                {pcLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.monoBtnText}>Connect wallet</Text>
                )}
              </Pressable>
            </>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.monoBtn, styles.monoBtnSecondary, styles.monoBtnCompact, pressed && styles.monoBtnPressed]}
              onPress={() => openWebViewWithdraw('SOL')}
            >
              <Text style={styles.monoBtnTextSecondary}>Withdraw</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.payLinksSectionHeader}>
        <Text style={styles.sectionTitle}>Invoices</Text>
        {hiddenCount > 0 && !showingHidden && (
          <Pressable
            style={({ pressed }) => [styles.showHiddenBtn, pressed && styles.showHiddenBtnPressed]}
            onPress={handleToggleHidden}
          >
            <Text style={styles.showHiddenBtnText}>Show hidden ({hiddenCount})</Text>
          </Pressable>
        )}
        {showingHidden && (
          <Pressable
            style={({ pressed }) => [styles.showHiddenBtn, pressed && styles.showHiddenBtnPressed]}
            onPress={handleToggleHidden}
          >
            <Text style={styles.showHiddenBtnText}>Hide hidden</Text>
          </Pressable>
        )}
      </View>
    </>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <FlatList
        data={payLinks}
        keyExtractor={(item) => item.id}
        renderItem={renderPayLink}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : (
            renderEmpty
          )
        }
        ListFooterComponent={
          payLinks.length > 0 ? (
            <View style={styles.footer}>
              <CreateButton noTopMargin />
            </View>
          ) : null
        }
        contentContainerStyle={[styles.list, payLinks.length === 0 && !loading && styles.listEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#fff"
            colors={['#fff']}
          />
        }
      />

      <CreatePayLinkModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreate={handleCreateWithTitle}
        creating={creating}
      />
      <PayLinkModal
        visible={successModalVisible}
        publicKey={newLinkPublicKey}
        payLinkId={newLinkId}
        onClose={() => setSuccessModalVisible(false)}
      />

      <Modal visible={withdrawModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => !withdrawing && setWithdrawModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Withdraw</Text>
            <View style={styles.modalTokenRow}>
              {PC_TOKENS.map((token) => (
                <Pressable
                  key={token}
                  style={({ pressed }) => [
                    styles.modalTokenBtn,
                    withdrawToken === token && styles.modalTokenBtnActive,
                    pressed && styles.modalTokenBtnPressed,
                  ]}
                  onPress={() => { setWithdrawToken(token); setWithdrawError(''); setWithdrawAmount(''); }}
                  disabled={withdrawing}
                >
                  <Text style={[styles.modalTokenBtnText, withdrawToken === token && styles.modalTokenBtnTextActive]}>
                    {PRIVACYCASH_TOKEN_LABELS[token]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.modalDesc}>Send to a Solana wallet address</Text>
            <TextInput
              style={[styles.modalInput, withdrawError ? styles.modalInputError : null]}
              placeholder="Destination wallet address"
              placeholderTextColor={colors.textMuted}
              value={withdrawAddress}
              onChangeText={(t) => {
                setWithdrawAddress(t);
                setWithdrawError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!withdrawing}
            />
            <TextInput
              style={[styles.modalInput, withdrawError ? styles.modalInputError : null]}
              placeholder={`Amount ${PRIVACYCASH_TOKEN_LABELS[withdrawToken]}`}
              placeholderTextColor={colors.textMuted}
              value={withdrawAmount}
              onChangeText={(t) => {
                setWithdrawAmount(t);
                setWithdrawError('');
              }}
              keyboardType="decimal-pad"
              editable={!withdrawing}
            />
            {withdrawError ? <Text style={styles.pcErrorText}>{withdrawError}</Text> : null}
            {withdrawing ? (
              <View style={styles.withdrawingContainer}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.withdrawingText}>Generating ZK proof...</Text>
                <Text style={styles.withdrawingSubtext}>This may take 1-3 minutes on our servers. Please keep the app open.</Text>
              </View>
            ) : (
              <View style={styles.modalButtons}>
                <Pressable
                  style={({ pressed }) => [styles.modalBtn, styles.modalBtnSecondary, pressed && styles.modalBtnPressed]}
                  onPress={() => setWithdrawModalVisible(false)}
                >
                  <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.modalBtn,
                    styles.modalBtnPrimary,
                    pressed && styles.modalBtnPressed,
                  ]}
                  onPress={handleWithdraw}
                >
                  <Text style={styles.modalBtnTextPrimary}>Withdraw</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#5b21b6',
    paddingHorizontal: spacing.xl,
  },
  header: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.title,
    color: '#fff',
    fontSize: 26,
  },
  subtitle: {
    ...typography.subtitle,
    color: 'rgba(255,255,255,0.85)',
    marginTop: spacing.xs,
  },
  showHiddenBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignSelf: 'flex-start',
  },
  showHiddenBtnPressed: {
    opacity: 0.7,
  },
  showHiddenBtnText: {
    ...typography.caption,
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  sectionTitle: {
    ...typography.subtitle,
    fontSize: 16,
    color: '#fff',
    marginBottom: spacing.md,
  },
  privateWalletCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: spacing.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  privateWalletLeft: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  privateWalletTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  privateWalletDesc: {
    fontSize: 12,
    color: '#6b7280',
  },
  privateWalletBalancesCompact: {
    fontSize: 12,
    color: '#374151',
  },
  privateWalletRight: {
    marginLeft: spacing.md,
  },
  pcErrorTextCard: {
    ...typography.caption,
    color: '#dc2626',
    marginBottom: spacing.md,
  },
  pcErrorText: {
    ...typography.caption,
    color: colors.error,
    marginBottom: spacing.sm,
  },
  monoBtn: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  monoBtnCompact: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  monoBtnSecondary: {
    backgroundColor: '#f3f4f6',
  },
  monoBtnPressed: {
    opacity: 0.9,
  },
  monoBtnDisabled: {
    opacity: 0.5,
  },
  monoBtnText: {
    ...typography.button,
    color: '#fff',
  },
  monoBtnTextSecondary: {
    ...typography.button,
    fontSize: 14,
    color: '#374151',
  },
  monoBtnTextDisabled: {
    color: '#9ca3af',
  },
  payLinksSectionHeader: {
    marginBottom: spacing.lg,
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
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  emptyIconLineShort: {
    width: 20,
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: spacing.sm,
  },
  emptyDesc: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.xl,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
    marginTop: spacing.xl,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
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
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardPressed: {
    opacity: 0.9,
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
    backgroundColor: '#7c3aed',
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    ...typography.mono,
    color: '#111827',
    fontSize: 14,
  },
  cardMeta: {
    ...typography.caption,
    color: '#6b7280',
    marginTop: 2,
  },
  balances: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  balanceBadge: {
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  balanceText: {
    ...typography.caption,
    fontSize: 11,
    color: '#7c3aed',
    fontWeight: '600',
  },
  copyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    marginLeft: spacing.md,
  },
  copyBtnSuccess: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  copyBtnPressed: {
    opacity: 0.8,
  },
  copyBtnText: {
    ...typography.caption,
    color: '#374151',
    fontSize: 13,
  },
  copyBtnTextSuccess: {
    color: '#16a34a',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  modalTitle: {
    ...typography.title,
    fontSize: 20,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  modalTokenRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modalTokenBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTokenBtnActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  modalTokenBtnPressed: {
    opacity: 0.8,
  },
  modalTokenBtnText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  modalTokenBtnTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  modalDesc: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  modalInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.md,
  },
  modalInputError: {
    borderColor: colors.error,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  modalBtnPrimary: {
    backgroundColor: colors.accent,
  },
  modalBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalBtnPressed: {
    opacity: 0.7,
  },
  modalBtnDisabled: {
    opacity: 0.5,
  },
  modalBtnTextPrimary: {
    ...typography.button,
    color: colors.text,
  },
  modalBtnTextSecondary: {
    ...typography.button,
    color: colors.textMuted,
  },
  withdrawingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  withdrawingText: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.md,
  },
  withdrawingSubtext: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
