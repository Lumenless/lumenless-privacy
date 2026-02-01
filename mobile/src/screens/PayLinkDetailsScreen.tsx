import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Image,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { getTokenAccounts, TokenAccount } from '../services/tokens';
import { deletePayLink, PayLink, getPayLinkUrl, getPayLinkSecretKey } from '../services/paylink';
import {
  isValidSolanaAddress,
  base64AddressToBase58,
  claimAllTokens,
  ClaimResult,
  getClaimablePrivacyCashTokens,
  hasClaimablePrivacyCashTokens,
  payLinkHasSolForGas,
  claimToPrivacyCash,
  ClaimToPrivacyCashResult,
} from '../services/transfer';
import { VersionedTransaction } from '@solana/web3.js';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../navigation/AppNavigator';
import Logo from '../components/Logo';

type NavigationProp = StackNavigationProp<RootStackParamList>;
type PayLinkDetailsRouteProp = RouteProp<RootStackParamList, 'PayLinkDetails'>;

export default function PayLinkDetailsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<PayLinkDetailsRouteProp>();
  const { payLink } = route.params;

  const [tokens, setTokens] = useState<TokenAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  
  // Claim publicly modal state
  const [claimModalVisible, setClaimModalVisible] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [walletError, setWalletError] = useState('');
  const [claiming, setClaiming] = useState(false);

  // Claim into PrivacyCash modal state
  const [privacyCashModalVisible, setPrivacyCashModalVisible] = useState(false);
  const [privacyCashClaiming, setPrivacyCashClaiming] = useState(false);

  // Backup wallet modal state
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    loadTokens();
  }, []);

  const loadTokens = async () => {
    setLoading(true);
    try {
      const tokenAccounts = await getTokenAccounts(payLink.publicKey);
      setTokens(tokenAccounts);
    } catch (error) {
      console.error('Error loading tokens:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadTokens();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleHide = async () => {
    setHiding(true);
    try {
      await deletePayLink(payLink.id);
      navigation.goBack();
    } catch (error) {
      console.error('Error hiding pay link:', error);
    } finally {
      setHiding(false);
    }
  };

  const handleCopyLink = async () => {
    const url = getPayLinkUrl(payLink.publicKey);
    await Clipboard.setStringAsync(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleOpenClaimModal = () => {
    setWalletAddress('');
    setWalletError('');
    setClaimModalVisible(true);
  };

  const handleCloseClaimModal = () => {
    if (!claiming) {
      setClaimModalVisible(false);
      setWalletAddress('');
      setWalletError('');
    }
  };

  const handleOpenClaimIntoPrivacyCash = () => {
    if (!hasClaimablePrivacyCashTokens(tokens)) {
      Alert.alert(
        'Nothing to claim',
        'This pay link has no SOL. Only SOL can be claimed into PrivacyCash for now. Use "Claim publicly" for other tokens.',
        [{ text: 'OK' }]
      );
      return;
    }
    
    // Check if SOL balance is at least 0.008 SOL (8,000,000 lamports) for fees
    const solToken = tokens.find(t => t.mint === 'So11111111111111111111111111111111111111112');
    const MIN_SOL_FOR_CLAIM = 8_000_000; // 0.008 SOL in lamports
    if (solToken && solToken.amount < MIN_SOL_FOR_CLAIM) {
      const solBalance = solToken.amount / 1e9;
      Alert.alert(
        'Insufficient SOL',
        `This pay link needs at least 0.008 SOL to claim into PrivacyCash (for transaction fees). Current balance: ${solBalance.toFixed(4)} SOL.\n\nUse "Claim publicly" instead, or add more SOL to this pay link.`,
        [{ text: 'OK' }]
      );
      return;
    }
    
    setPrivacyCashModalVisible(true);
  };

  const handleClosePrivacyCashModal = () => {
    if (!privacyCashClaiming) {
      setPrivacyCashModalVisible(false);
    }
  };

  const handleOpenBackupModal = async () => {
    try {
      const secretKey = await getPayLinkSecretKey(payLink.id);
      if (!secretKey) {
        Alert.alert('Error', 'Could not retrieve wallet private key');
        return;
      }
      setPrivateKey(secretKey);
      setBackupModalVisible(true);
    } catch (error) {
      console.error('Error getting private key:', error);
      Alert.alert('Error', 'Could not retrieve wallet private key');
    }
  };

  const handleCloseBackupModal = () => {
    setBackupModalVisible(false);
    setPrivateKey('');
    setCopiedKey(false);
  };

  const handleCopyPrivateKey = async () => {
    await Clipboard.setStringAsync(privateKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleClaimIntoPrivacyCash = async () => {
    const claimable = getClaimablePrivacyCashTokens(tokens);
    const payLinkHasSol = payLinkHasSolForGas(tokens);

    setPrivacyCashClaiming(true);
    try {
      const secretKey = await getPayLinkSecretKey(payLink.id);
      if (!secretKey) {
        throw new Error('Could not retrieve pay link keys');
      }

      // Dynamic import to avoid loading wallet adapter until user taps Claim
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

        const signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
          const result = await wallet.signMessages({
            addresses: [base64Address],
            payloads: [message],
          });
          return result[0];
        };

        const signTransaction = async (tx: Uint8Array): Promise<Uint8Array> => {
          const versionedTx = VersionedTransaction.deserialize(tx);
          const [signedTx] = await wallet.signTransactions({
            transactions: [versionedTx],
          });
          return new Uint8Array(signedTx.serialize());
        };

        const result: ClaimToPrivacyCashResult = await claimToPrivacyCash(
          secretKey,
          userPublicKey,
          signMessage,
          signTransaction,
          claimable,
          payLinkHasSol
        );

        if (result.success) {
          setPrivacyCashModalVisible(false);
          Alert.alert(
            'Claim Successful',
            `Deposited into your PrivacyCash balance.${result.signatures.length ? `\n\nTx: ${result.signatures[0]}` : ''}`,
            [{ text: 'OK' }]
          );
          loadTokens();
        } else {
          Alert.alert('Claim into PrivacyCash', result.error ?? 'Something went wrong.', [{ text: 'OK' }]);
        }
      });
    } catch (error: any) {
      console.error('[ClaimIntoPrivacyCash] Error:', error);
      Alert.alert(
        'Error',
        error?.message || 'Could not complete claim. Make sure your wallet app is installed and try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setPrivacyCashClaiming(false);
    }
  };

  const validateWalletAddress = (address: string): boolean => {
    if (!address.trim()) {
      setWalletError('Please enter a wallet address');
      return false;
    }
    
    if (!isValidSolanaAddress(address.trim())) {
      setWalletError('Invalid Solana wallet address');
      return false;
    }
    
    setWalletError('');
    return true;
  };

  const handleClaimPublicly = async () => {
    const trimmedAddress = walletAddress.trim();
    
    if (!validateWalletAddress(trimmedAddress)) {
      return;
    }
    
    setClaiming(true);
    
    try {
      // Get the secret key for this paylink
      const secretKey = await getPayLinkSecretKey(payLink.id);
      if (!secretKey) {
        throw new Error('Could not retrieve pay link keys');
      }
      
      // Claim all tokens
      const result: ClaimResult = await claimAllTokens(secretKey, trimmedAddress, tokens);
      
      // Close modal
      setClaimModalVisible(false);
      setWalletAddress('');
      
      // Show result
      if (result.successfulTransfers === result.totalTokens) {
        Alert.alert(
          'Claim Successful',
          `Successfully transferred ${result.successfulTransfers} token${result.successfulTransfers !== 1 ? 's' : ''} to your wallet.`,
          [{ text: 'OK' }]
        );
      } else if (result.successfulTransfers > 0) {
        Alert.alert(
          'Partial Success',
          `Transferred ${result.successfulTransfers}/${result.totalTokens} tokens.\n\nErrors:\n${result.errors.join('\n')}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Claim Failed',
          `Failed to transfer tokens.\n\nErrors:\n${result.errors.join('\n')}`,
          [{ text: 'OK' }]
        );
      }
      
      // Refresh token list
      await loadTokens();
    } catch (error: any) {
      console.error('[Claim] Error:', error);
      Alert.alert(
        'Error',
        error?.message || 'An unexpected error occurred while claiming tokens.',
        [{ text: 'OK' }]
      );
    } finally {
      setClaiming(false);
    }
  };

  const formatBalance = (amount: number, decimals: number): string => {
    // Convert from raw units (lamports/base units) to human-readable
    const humanAmount = amount / Math.pow(10, decimals);
    if (humanAmount === 0) return '0';
    if (humanAmount < 0.0001) return humanAmount.toExponential(2);
    if (humanAmount < 0.01) return humanAmount.toFixed(decimals);
    if (humanAmount < 1) return humanAmount.toFixed(4);
    if (humanAmount < 1000) return humanAmount.toFixed(2);
    return humanAmount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  const getTokenDisplayName = (token: TokenAccount): string => {
    if (token.symbol) return token.symbol;
    if (token.name) return token.name;
    return `${token.mint.slice(0, 4)}...${token.mint.slice(-4)}`;
  };

  const getTokenFullName = (token: TokenAccount): string => {
    if (token.name) return token.name;
    if (token.symbol) return token.symbol;
    return token.mint;
  };

  const truncateAddress = (address: string, start = 7, end = 5) => {
    if (address.length <= start + end) return address;
    return `${address.slice(0, start)}...${address.slice(-end)}`;
  };

  const renderToken = ({ item }: { item: TokenAccount }) => {
    const displayName = getTokenDisplayName(item);
    const fullName = getTokenFullName(item);
    const isSol = item.mint === 'So11111111111111111111111111111111111111112';

    // Debug: Log logoURI if present
    if (item.logoURI) {
      console.log(`[PayLinkDetails] Rendering token ${item.symbol || item.mint} with logoURI: ${item.logoURI}`);
    }

    return (
      <View style={styles.tokenRow}>
        <View style={styles.tokenInfo}>
          {item.logoURI ? (
            <Image
              source={{ uri: item.logoURI }}
              style={styles.tokenIcon}
              resizeMode="cover"
              onLoad={() => {
                console.log(`[PayLinkDetails] Image loaded successfully for ${item.symbol || item.mint}: ${item.logoURI}`);
              }}
              onError={(error) => {
                console.error(`[PayLinkDetails] Image load error for ${item.symbol || item.mint}:`, error.nativeEvent?.error || 'Unknown error', `URL: ${item.logoURI}`);
              }}
            />
          ) : (
            <View style={[styles.tokenIconPlaceholder, isSol && styles.tokenIconPlaceholderSol]}>
              <Text style={styles.tokenIconText}>{displayName.slice(0, 2).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.tokenDetails}>
            <Text style={styles.tokenName} numberOfLines={1}>
              {displayName}
            </Text>
            {item.name && item.name !== displayName && (
              <Text style={styles.tokenFullName} numberOfLines={1}>
                {item.name}
              </Text>
            )}
            {!item.name && !item.symbol && (
              <Text style={styles.tokenMint} numberOfLines={1}>
                {truncateAddress(item.mint)}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.tokenAmountContainer}>
          <Text style={styles.tokenAmount}>
            {formatBalance(item.amount, item.decimals)}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIconContainer}>
        <Logo width={80} height={80} color={colors.text} />
      </View>
      <Text style={styles.emptyTitle}>This pay link is empty</Text>
      <Text style={styles.emptyDesc}>
        No tokens have been received yet. Share the link to start receiving payments.
      </Text>
    </View>
  );

  const title = payLink.label?.trim() || 'Payment link';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [
            styles.backBtn,
            pressed && styles.backBtnPressed,
          ]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {truncateAddress(payLink.publicKey)}
          </Text>
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : tokens.length === 0 ? (
        <>
          <ScrollView
            contentContainerStyle={styles.emptyContainer}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.accent}
                colors={[colors.accent]}
              />
            }
          >
            {renderEmpty()}
          </ScrollView>
          {/* Action Buttons at Bottom for empty state */}
          <View style={[styles.actionButtonsContainer, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.bottomButtonsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.bottomBtn,
                  styles.bottomBtnPrimary,
                  pressed && styles.bottomBtnPressed,
                ]}
                onPress={handleCopyLink}
              >
                <Text style={styles.bottomBtnTextPrimary}>
                  {copiedLink ? '✓ Copied!' : 'Copy link'}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.bottomBtn,
                  styles.bottomBtnSecondary,
                  pressed && styles.bottomBtnPressed,
                ]}
                onPress={handleOpenBackupModal}
              >
                <Text style={styles.bottomBtnTextSecondary}>Backup</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.bottomBtn,
                  styles.bottomBtnSecondary,
                  hiding && styles.bottomBtnDisabled,
                  pressed && styles.bottomBtnPressed,
                ]}
                onPress={handleHide}
                disabled={hiding}
              >
                <Text style={styles.bottomBtnTextSecondary}>
                  {hiding ? 'Hiding...' : 'Hide'}
                </Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : (
        <>
          <FlatList
            data={tokens}
            keyExtractor={(item, index) => `${item.mint}-${index}`}
            renderItem={renderToken}
            contentContainerStyle={styles.list}
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
          {/* Action Buttons at Bottom */}
          <View style={[styles.actionButtonsContainer, { paddingBottom: insets.bottom + spacing.lg }]}>
            {/* Claim buttons - only show if there are tokens */}
            {tokens.length > 0 && (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.actionBtnSecondary,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={handleOpenClaimIntoPrivacyCash}
                >
                  <Text style={styles.actionBtnTextSecondary}>Claim into PrivacyCash</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.actionBtnSecondary,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={handleOpenClaimModal}
                >
                  <Text style={styles.actionBtnTextSecondary}>Claim publicly</Text>
                </Pressable>
              </>
            )}
            {/* Copy link, Backup, and Hide buttons in same row */}
            <View style={styles.bottomButtonsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.bottomBtn,
                  styles.bottomBtnPrimary,
                  pressed && styles.bottomBtnPressed,
                ]}
                onPress={handleCopyLink}
              >
                <Text style={styles.bottomBtnTextPrimary}>
                  {copiedLink ? '✓ Copied!' : 'Copy link'}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.bottomBtn,
                  styles.bottomBtnSecondary,
                  pressed && styles.bottomBtnPressed,
                ]}
                onPress={handleOpenBackupModal}
              >
                <Text style={styles.bottomBtnTextSecondary}>Backup</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.bottomBtn,
                  styles.bottomBtnSecondary,
                  hiding && styles.bottomBtnDisabled,
                  pressed && styles.bottomBtnPressed,
                ]}
                onPress={handleHide}
                disabled={hiding}
              >
                <Text style={styles.bottomBtnTextSecondary}>
                  {hiding ? 'Hiding...' : 'Hide'}
                </Text>
              </Pressable>
            </View>
          </View>
        </>
      )}

      {/* Claim into PrivacyCash Modal */}
      <Modal
        visible={privacyCashModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleClosePrivacyCashModal}
      >
        <Pressable style={styles.modalOverlay} onPress={handleClosePrivacyCashModal}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Claim into PrivacyCash</Text>
            <Text style={styles.modalDesc}>
              Only SOL can be deposited into your PrivacyCash balance for now. Use "Claim publicly" for other tokens.
            </Text>
            {(() => {
              const claimable = getClaimablePrivacyCashTokens(tokens);
              const payLinkHasSol = payLinkHasSolForGas(tokens);
              return (
                <>
                  <View style={styles.claimableList}>
                    {claimable.map((item) => (
                      <View key={item.mint} style={styles.claimableRow}>
                        <Text style={styles.claimableSymbol}>{item.symbol ?? item.mint.slice(0, 8)}</Text>
                        <Text style={styles.claimableAmount}>
                          {formatBalance(item.amount, item.decimals)} {item.symbol ?? ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.modalButtons}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.modalBtn,
                        styles.modalBtnSecondary,
                        pressed && styles.modalBtnPressed,
                        privacyCashClaiming && styles.modalBtnDisabled,
                      ]}
                      onPress={handleClosePrivacyCashModal}
                      disabled={privacyCashClaiming}
                    >
                      <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.modalBtn,
                        styles.modalBtnPrimary,
                        pressed && styles.modalBtnPressed,
                        privacyCashClaiming && styles.modalBtnDisabled,
                      ]}
                      onPress={handleClaimIntoPrivacyCash}
                      disabled={privacyCashClaiming}
                    >
                      {privacyCashClaiming ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <Text style={styles.modalBtnTextPrimary}>Claim</Text>
                      )}
                    </Pressable>
                  </View>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Claim Publicly Modal */}
      <Modal
        visible={claimModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseClaimModal}
      >
        <Pressable style={styles.modalOverlay} onPress={handleCloseClaimModal}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Claim publicly</Text>
            <Text style={styles.modalDesc}>
              Enter the Solana wallet address where you want to receive your tokens.
            </Text>
            
            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, walletError ? styles.inputError : null]}
                placeholder="Solana wallet address"
                placeholderTextColor={colors.textMuted}
                value={walletAddress}
                onChangeText={(text) => {
                  setWalletAddress(text);
                  if (walletError) setWalletError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!claiming}
                selectTextOnFocus
              />
              {walletError ? (
                <Text style={styles.errorText}>{walletError}</Text>
              ) : null}
            </View>
            
            <View style={styles.modalButtons}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnSecondary,
                  pressed && styles.modalBtnPressed,
                  claiming && styles.modalBtnDisabled,
                ]}
                onPress={handleCloseClaimModal}
                disabled={claiming}
              >
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  pressed && styles.modalBtnPressed,
                  claiming && styles.modalBtnDisabled,
                ]}
                onPress={handleClaimPublicly}
                disabled={claiming}
              >
                {claiming ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={styles.modalBtnTextPrimary}>Claim tokens</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Backup Wallet Modal */}
      <Modal
        visible={backupModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseBackupModal}
      >
        <Pressable style={styles.modalOverlay} onPress={handleCloseBackupModal}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Backup wallet</Text>
            <Text style={styles.modalDesc}>
              This is the private key for this pay link wallet. Keep it safe and never share it with anyone.
            </Text>
            
            <View style={styles.privateKeyContainer}>
              <Text style={styles.privateKeyText} selectable>
                {privateKey}
              </Text>
            </View>
            
            <View style={styles.modalButtons}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnSecondary,
                  pressed && styles.modalBtnPressed,
                ]}
                onPress={handleCloseBackupModal}
              >
                <Text style={styles.modalBtnTextSecondary}>Close</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  pressed && styles.modalBtnPressed,
                ]}
                onPress={handleCopyPrivateKey}
              >
                <Text style={styles.modalBtnTextPrimary}>
                  {copiedKey ? '✓ Copied!' : 'Copy key'}
                </Text>
              </Pressable>
            </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
    borderRadius: radius.md,
  },
  backBtnPressed: {
    backgroundColor: colors.surface,
  },
  backBtnText: {
    fontSize: 28,
    color: colors.text,
    fontWeight: '300',
  },
  headerContent: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    ...typography.title,
    fontSize: 20,
    color: colors.text,
    fontWeight: '700',
  },
  headerSubtitle: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  empty: {
    alignItems: 'center',
    maxWidth: 320,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  emptyTitle: {
    ...typography.title,
    fontSize: 22,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyDesc: {
    ...typography.body,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  tokenInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    marginRight: spacing.md,
  },
  tokenIconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    marginRight: spacing.md,
    backgroundColor: colors.accentDim,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tokenIconPlaceholderSol: {
    backgroundColor: '#14F195',
  },
  tokenIconText: {
    ...typography.caption,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  tokenDetails: {
    flex: 1,
    minWidth: 0,
  },
  tokenName: {
    ...typography.body,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  tokenFullName: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textMuted,
  },
  tokenMint: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  tokenAmountContainer: {
    alignItems: 'flex-end',
    marginLeft: spacing.md,
  },
  tokenAmount: {
    ...typography.mono,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  actionButtonsContainer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  actionBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  actionBtnPrimary: {
    backgroundColor: colors.accent,
  },
  actionBtnSecondary: {
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  actionBtnTextPrimary: {
    ...typography.button,
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
  },
  actionBtnTextSecondary: {
    ...typography.button,
    fontSize: 15,
    color: colors.accent,
    fontWeight: '600',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  bottomBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  bottomBtnPrimary: {
    backgroundColor: colors.accent,
  },
  bottomBtnSecondary: {
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  bottomBtnPressed: {
    opacity: 0.7,
  },
  bottomBtnDisabled: {
    opacity: 0.5,
  },
  bottomBtnTextPrimary: {
    ...typography.button,
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
  },
  bottomBtnTextSecondary: {
    ...typography.button,
    fontSize: 15,
    color: colors.accent,
    fontWeight: '600',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 120,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalContent: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: '90%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    ...typography.title,
    fontSize: 22,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  modalDesc: {
    ...typography.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  inputContainer: {
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: 'monospace',
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    ...typography.caption,
    fontSize: 13,
    color: colors.error,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
  privateKeyContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  privateKeyText: {
    ...typography.mono,
    fontSize: 12,
    color: colors.text,
    lineHeight: 18,
  },
  claimableList: {
    marginVertical: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  claimableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  claimableSymbol: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  claimableAmount: {
    ...typography.body,
    color: colors.textMuted,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
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
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
  },
  modalBtnTextSecondary: {
    ...typography.button,
    fontSize: 15,
    color: colors.textMuted,
    fontWeight: '600',
  },
});
