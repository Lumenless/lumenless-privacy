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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { getTokenAccounts, TokenAccount } from '../services/tokens';
import { deletePayLink, PayLink, getPayLinkUrl } from '../services/paylink';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../navigation/AppNavigator';
import Logo from '../components/Logo';

type NavigationProp = StackNavigationProp<RootStackParamList>;
type RouteProp = RouteProp<RootStackParamList, 'PayLinkDetails'>;

export default function PayLinkDetailsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp>();
  const { payLink } = route.params;

  const [tokens, setTokens] = useState<TokenAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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

  const formatBalance = (amount: number, decimals: number): string => {
    if (amount === 0) return '0';
    if (amount < 0.0001) return amount.toExponential(2);
    if (amount < 0.01) return amount.toFixed(decimals);
    if (amount < 1) return amount.toFixed(2);
    if (amount < 1000) return amount.toFixed(2);
    return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
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

    return (
      <View style={styles.tokenRow}>
        <View style={styles.tokenInfo}>
          {item.logoURI ? (
            <Image
              source={{ uri: item.logoURI }}
              style={styles.tokenIcon}
              resizeMode="cover"
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
                  onPress={() => {}}
                >
                  <Text style={styles.actionBtnTextSecondary}>Claim into PrivacyCash</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.actionBtnSecondary,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={() => {}}
                >
                  <Text style={styles.actionBtnTextSecondary}>Claim publicly</Text>
                </Pressable>
              </>
            )}
            {/* Copy link and Hide buttons in same row */}
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
});
