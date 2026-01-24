import { StyleSheet, Text, View, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { PayLinkModal } from '../components';
import { createPayLink, getPayLinks, getPayLinkUrl, PayLink } from '../services/paylink';
import * as Clipboard from 'expo-clipboard';

export default function PayLinksScreen() {
  const insets = useSafeAreaInsets();
  const [payLinks, setPayLinks] = useState<PayLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [newLinkPublicKey, setNewLinkPublicKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadPayLinks = useCallback(async () => {
    setLoading(true);
    const links = await getPayLinks();
    setPayLinks(links);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPayLinks();
  }, [loadPayLinks]);

  const handleCreatePayLink = async () => {
    setCreating(true);
    try {
      const link = await createPayLink();
      setNewLinkPublicKey(link.publicKey);
      setModalVisible(true);
      // Refresh list
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
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateKey = (key: string) => {
    if (key.length <= 12) return key;
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  };

  const renderPayLink = ({ item }: { item: PayLink }) => (
    <View style={styles.linkCard}>
      <View style={styles.linkInfo}>
        <Text style={styles.linkAddress}>{truncateKey(item.publicKey)}</Text>
        <Text style={styles.linkDate}>{formatDate(item.createdAt)}</Text>
      </View>
      <TouchableOpacity
        style={[styles.copySmallButton, copiedId === item.id && styles.copySmallButtonSuccess]}
        onPress={() => handleCopyLink(item.publicKey, item.id)}
        activeOpacity={0.7}
      >
        <Text style={styles.copySmallButtonText}>
          {copiedId === item.id ? '✓' : 'Copy'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const CreateButton = ({ noTopMargin }: { noTopMargin?: boolean }) => (
    <TouchableOpacity
      style={[styles.createButton, noTopMargin && styles.createButtonNoMargin]}
      onPress={handleCreatePayLink}
      activeOpacity={0.8}
      disabled={creating}
    >
      {creating ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <>
          <Text style={styles.createButtonIcon}>+</Text>
          <Text style={styles.createButtonText}>Create Pay Link</Text>
        </>
      )}
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>🔗</Text>
      <Text style={styles.emptyTitle}>No Pay Links Yet</Text>
      <Text style={styles.emptyDescription}>
        Create your first pay link to start receiving payments privately.
      </Text>
      <CreateButton />
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Lumenless</Text>
        <Text style={styles.subtitle}>Receive payments anonymously</Text>
      </View>

      {/* Links List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8000FF" />
        </View>
      ) : (
        <FlatList
          data={payLinks}
          keyExtractor={(item) => item.id}
          renderItem={renderPayLink}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            payLinks.length > 0 ? (
              <View style={styles.footerButtonWrap}>
                <CreateButton noTopMargin />
              </View>
            ) : null
          }
          contentContainerStyle={[
            styles.listContent,
            payLinks.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal */}
      <PayLinkModal
        visible={modalVisible}
        publicKey={newLinkPublicKey}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginTop: 4,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8000FF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
    marginTop: 24,
    alignSelf: 'center',
  },
  createButtonNoMargin: {
    marginTop: 0,
  },
  createButtonIcon: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '300',
  },
  createButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: 20,
  },
  footerButtonWrap: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 24,
  },
  listContentEmpty: {
    flex: 1,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  linkInfo: {
    flex: 1,
  },
  linkAddress: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'monospace',
  },
  linkDate: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  copySmallButton: {
    backgroundColor: 'rgba(128, 0, 255, 0.15)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  copySmallButtonSuccess: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
  },
  copySmallButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8000FF',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
});
