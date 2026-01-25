import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { getTokenAccounts, TokenAccount } from '../services/tokens';
import { deletePayLink, PayLink, getPayLinkUrl } from '../services/paylink';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../navigation/AppNavigator';

type NavigationProp = StackNavigationProp<RootStackParamList>;
type RouteProp = RouteProp<RootStackParamList, 'PayLinkDetails'>;

export default function PayLinkDetailsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp>();
  const { payLink } = route.params;

  const [tokens, setTokens] = useState<TokenAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiding, setHiding] = useState(false);

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

  const formatBalance = (amount: number, decimals: number): string => {
    if (amount === 0) return '0';
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

  const renderToken = ({ item }: { item: TokenAccount }) => (
    <View style={styles.tokenCard}>
      <View style={styles.tokenHeader}>
        <View style={styles.tokenInfo}>
          <Text style={styles.tokenName}>{getTokenDisplayName(item)}</Text>
          <Text style={styles.tokenAmount}>
            {formatBalance(item.amount, item.decimals)}
          </Text>
        </View>
      </View>
      <View style={styles.tokenActions}>
        <Pressable style={styles.actionBtn} onPress={() => {}}>
          <Text style={styles.actionBtnText}>Copy link</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => {}}>
          <Text style={styles.actionBtnText}>Claim into PrivacyCash</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => {}}>
          <Text style={styles.actionBtnText}>Claim publicly</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>💼</Text>
      <Text style={styles.emptyTitle}>This pay link is empty</Text>
      <Text style={styles.emptyDesc}>
        No tokens have been received yet. Share the link to start receiving payments.
      </Text>
    </View>
  );

  const title = payLink.label?.trim() || payLink.publicKey.slice(0, 8) + '...';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {payLink.publicKey}
          </Text>
        </View>
        <Pressable
          style={[styles.hideBtn, hiding && styles.hideBtnDisabled]}
          onPress={handleHide}
          disabled={hiding}
        >
          <Text style={styles.hideBtnText}>{hiding ? 'Hiding...' : 'Hide'}</Text>
        </Pressable>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : tokens.length === 0 ? (
        <ScrollView contentContainerStyle={styles.emptyContainer}>
          {renderEmpty()}
        </ScrollView>
      ) : (
        <FlatList
          data={tokens}
          keyExtractor={(item, index) => `${item.mint}-${index}`}
          renderItem={renderToken}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
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
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  backBtnText: {
    fontSize: 24,
    color: colors.text,
    fontWeight: '300',
  },
  headerContent: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.text,
  },
  headerSubtitle: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  hideBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    backgroundColor: colors.accentDim,
  },
  hideBtnDisabled: {
    opacity: 0.6,
  },
  hideBtnText: {
    ...typography.caption,
    fontSize: 13,
    color: colors.accent,
    fontWeight: '600',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  empty: {
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: spacing.xl,
  },
  emptyTitle: {
    ...typography.title,
    fontSize: 20,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyDesc: {
    ...typography.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },
  tokenCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tokenHeader: {
    marginBottom: spacing.md,
  },
  tokenInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tokenName: {
    ...typography.body,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  tokenAmount: {
    ...typography.mono,
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
  },
  tokenActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flex: 1,
    minWidth: '30%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
  },
  actionBtnText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
    textAlign: 'center',
  },
});
