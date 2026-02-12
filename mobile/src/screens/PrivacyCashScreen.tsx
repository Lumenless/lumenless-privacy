import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useCallback } from 'react';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import {
  getPrivacyCashBalance,
  withdrawFromPrivacyCash,
  PrivacyCashBalances,
  WithdrawResult,
  TokenKind,
  PRIVACYCASH_TOKEN_LABELS,
} from '../services/privacycash';
import { isValidSolanaAddress, base64AddressToBase58 } from '../services/transfer';
import { getWalletErrorMessage } from '../utils/walletErrors';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../navigation/AppNavigator';
import { logScreenView, logEvent, analyticsEvents } from '../services/firebase';

type NavigationProp = StackNavigationProp<RootStackParamList>;

export default function PrivacyCashScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();

  const [balance, setBalance] = useState<PrivacyCashBalances | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [withdrawToken, setWithdrawToken] = useState<TokenKind>('SOL');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      logScreenView('PrivacyCash', 'PrivacyCashScreen');
    }, [])
  );

  const handleConnectAndLoadBalance = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const mwa = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
      await mwa.transact(async (wallet) => {
        const authResult = await wallet.authorize({
          cluster: 'mainnet-beta',
          identity: {
            name: 'Lumenless',
            uri: 'https://lumenless.com',
            icon: 'icon.png',
          },
        });
        const base64Address = authResult.accounts[0].address;
        const userPublicKey = base64AddressToBase58(base64Address);
        setUserAddress(userPublicKey);

        const signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
          const result = await wallet.signMessages({ addresses: [base64Address], payloads: [message] });
          return result[0];
        };

        const storage = null;
        const balances = await getPrivacyCashBalance(userPublicKey, signMessage, storage);
        setBalance(balances);
        logEvent(analyticsEvents.walletConnect, { source: 'privacy_cash_screen' });
      });
    } catch (err: unknown) {
      console.error('[PrivacyCash] connect/balance error:', err);
      setError(getWalletErrorMessage(err, 'Could not load balance. Connect your wallet and try again.'));
      if (!isRefresh) {
        setBalance(null);
        setUserAddress(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const openWithdrawModal = (token: TokenKind) => {
    setWithdrawToken(token);
    setWithdrawAddress('');
    setWithdrawAmount('');
    setWithdrawError('');
    setWithdrawModalVisible(true);
  };

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

    const bal = balance ?? { sol: 0, usdc: 0 };
    const maxAmount = withdrawToken === 'SOL' ? bal.sol : bal.usdc;
    if (amount > maxAmount) {
      setWithdrawError(`Insufficient balance (max ${maxAmount})`);
      return;
    }

    setWithdrawing(true);
    setWithdrawError('');
    try {
      const mwa = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');

      await mwa.transact(async (wallet) => {
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
          const { VersionedTransaction } = await import('@solana/web3.js');
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
          setBalance((prev) => prev ? { ...prev, [withdrawToken.toLowerCase()]: Math.max(0, (prev[withdrawToken === 'SOL' ? 'sol' : 'usdc'] - amount)) } : null);
        } else {
          setWithdrawError(result.error ?? 'Withdrawal failed');
        }
      });
    } catch (err: unknown) {
      setWithdrawError(getWalletErrorMessage(err, 'Withdrawal failed. Please try again.'));
    } finally {
      setWithdrawing(false);
    }
  }, [balance, withdrawAddress, withdrawAmount, withdrawToken]);

  const formatBalance = (value: number): string => {
    if (value === 0) return '0';
    if (value < 0.0001) return value.toExponential(2);
    if (value < 1) return value.toFixed(4);
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  // Only SOL is supported for now
  const tokens: TokenKind[] = ['SOL'];

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>My PrivacyCash</Text>
        <Text style={styles.subtitle}>Private balance (SOL only for now)</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {!userAddress ? (
          <View style={styles.connectBlock}>
            <Text style={styles.connectDesc}>Connect your Solana wallet to view and withdraw your PrivacyCash balance.</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.connectBtn, pressed && styles.connectBtnPressed]}
              onPress={() => handleConnectAndLoadBalance(false)}
              disabled={loading}
            >
              {loading ? <ActivityIndicator size="small" color={colors.text} /> : <Text style={styles.connectBtnText}>Connect wallet & load balance</Text>}
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.addressBlock}>
              <Text style={styles.addressLabel}>Wallet</Text>
              <Text style={styles.addressValue} numberOfLines={1} ellipsizeMode="middle">{userAddress}</Text>
            </View>
            <View style={styles.balanceCard}>
              <View style={styles.balanceCardHeader}>
                <Text style={styles.balanceCardTitle}>Balance</Text>
                <Pressable 
                  style={({ pressed }) => [styles.refreshBtn, pressed && styles.refreshBtnPressed, refreshing && styles.refreshBtnDisabled]} 
                  onPress={() => handleConnectAndLoadBalance(true)} 
                  disabled={refreshing}
                >
                  {refreshing ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text style={styles.refreshBtnText}>↻ Refresh</Text>
                  )}
                </Pressable>
              </View>
              {tokens.map((token) => {
                const value = balance ? balance[token === 'SOL' ? 'sol' : 'usdc'] : 0;
                return (
                  <View key={token} style={styles.balanceRow}>
                    <Text style={styles.balanceSymbol}>{PRIVACYCASH_TOKEN_LABELS[token]}</Text>
                    <Text style={styles.balanceValue}>{formatBalance(value)}</Text>
                    <Pressable
                      style={({ pressed }) => [styles.withdrawBtn, pressed && styles.withdrawBtnPressed]}
                      onPress={() => openWithdrawModal(token)}
                      disabled={value <= 0}
                    >
                      <Text style={[styles.withdrawBtnText, value <= 0 && styles.withdrawBtnTextDisabled]}>Withdraw</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* Withdraw Modal */}
      <Modal visible={withdrawModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => !withdrawing && setWithdrawModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Withdraw {PRIVACYCASH_TOKEN_LABELS[withdrawToken]}</Text>
            <Text style={styles.modalDesc}>Send to a Solana wallet address</Text>
            <TextInput
              style={[styles.input, withdrawError ? styles.inputError : null]}
              placeholder="Destination wallet address"
              placeholderTextColor={colors.textMuted}
              value={withdrawAddress}
              onChangeText={(t) => { setWithdrawAddress(t); setWithdrawError(''); }}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!withdrawing}
            />
            <TextInput
              style={[styles.input, withdrawError ? styles.inputError : null]}
              placeholder={`Amount ${PRIVACYCASH_TOKEN_LABELS[withdrawToken]}`}
              placeholderTextColor={colors.textMuted}
              value={withdrawAmount}
              onChangeText={(t) => { setWithdrawAmount(t); setWithdrawError(''); }}
              keyboardType="decimal-pad"
              editable={!withdrawing}
            />
            {withdrawError ? <Text style={styles.errorText}>{withdrawError}</Text> : null}
            {withdrawing ? (
              <View style={styles.withdrawingContainer}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.withdrawingText}>Generating ZK proof...</Text>
                <Text style={styles.withdrawingSubtext}>This may take 1-3 minutes on our servers. Please keep the app open.</Text>
              </View>
            ) : (
              <View style={styles.modalButtons}>
                <Pressable style={({ pressed }) => [styles.modalBtn, styles.modalBtnSecondary, pressed && styles.modalBtnPressed]} onPress={() => setWithdrawModalVisible(false)}>
                  <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.modalBtn, styles.modalBtnPrimary, pressed && styles.modalBtnPressed]} onPress={handleWithdraw}>
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
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  backBtnText: {
    ...typography.body,
    color: colors.accent,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.subtitle,
    color: colors.textMuted,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  connectBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  connectDesc: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  connectBtn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  connectBtnPressed: {
    opacity: 0.8,
  },
  connectBtnText: {
    ...typography.button,
    color: colors.text,
  },
  addressBlock: {
    marginBottom: spacing.lg,
    paddingVertical: spacing.sm,
  },
  addressLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  addressValue: {
    ...typography.mono,
    color: colors.textSecondary,
    fontSize: 13,
  },
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  balanceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  balanceCardTitle: {
    ...typography.subtitle,
    color: colors.text,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  balanceSymbol: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    width: 56,
  },
  balanceValue: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  withdrawBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.accentDim,
  },
  withdrawBtnPressed: {
    opacity: 0.8,
  },
  withdrawBtnText: {
    ...typography.button,
    fontSize: 14,
    color: colors.accent,
  },
  withdrawBtnTextDisabled: {
    color: colors.textMuted,
  },
  refreshBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 80,
    alignItems: 'center',
  },
  refreshBtnPressed: {
    opacity: 0.7,
  },
  refreshBtnDisabled: {
    opacity: 0.5,
  },
  refreshBtnText: {
    ...typography.body,
    fontSize: 14,
    color: colors.accent,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
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
    marginBottom: spacing.xs,
  },
  modalDesc: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  input: {
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
  inputError: {
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
