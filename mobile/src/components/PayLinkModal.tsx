import { View, Text, StyleSheet, Modal, Pressable, Animated, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRef, useEffect, useState } from 'react';
import { getPayLinkUrl, getPayLinkSecretKey } from '../services/paylink';
import { colors, spacing, radius, typography } from '../theme';

interface PayLinkModalProps {
  visible: boolean;
  publicKey: string | null;
  payLinkId: string | null;
  onClose: () => void;
}

export default function PayLinkModal({ visible, publicKey, payLinkId, onClose }: PayLinkModalProps) {
  const [copied, setCopied] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (visible) {
      setCopied(false);
      setShowBackup(false);
      setPrivateKey(null);
      setCopiedKey(false);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 10, tension: 90, useNativeDriver: true }),
      ]).start();
    } else {
      fade.setValue(0);
      scale.setValue(0.92);
    }
  }, [visible]);

  const handleCopy = async () => {
    if (!publicKey) return;
    await Clipboard.setStringAsync(getPayLinkUrl(publicKey));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBackup = async () => {
    if (!payLinkId || showBackup) return;

    Alert.alert(
      'Backup Private Key',
      'This will reveal the private key for this invoice wallet. Anyone with this key can access the funds. Keep it safe and never share it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Show Key',
          style: 'destructive',
          onPress: async () => {
            const key = await getPayLinkSecretKey(payLinkId);
            if (key) {
              setPrivateKey(key);
              setShowBackup(true);
            }
          },
        },
      ]
    );
  };

  const handleCopyPrivateKey = async () => {
    if (!privateKey) return;
    await Clipboard.setStringAsync(privateKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  if (!publicKey) return null;

  const payUrl = getPayLinkUrl(publicKey);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              opacity: fade,
              transform: [{ scale }],
            },
          ]}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeText}>✓</Text>
          </View>

          <Text style={styles.title}>Link created</Text>
          <Text style={styles.desc}>
            Share this link with the payer. Once they pay, you'll receive it in your PrivacyCash balance.
          </Text>

          <View style={styles.urlWrap}>
            <Text style={styles.url} numberOfLines={2} selectable>
              {payUrl}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.copyBtn,
              copied && styles.copyBtnDone,
              pressed && styles.copyBtnPressed,
            ]}
            onPress={handleCopy}
          >
            <Text style={styles.copyBtnLabel}>
              {copied ? 'Copied to clipboard' : 'Copy link'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.backupBtn,
              showBackup && styles.backupBtnDisabled,
              pressed && !showBackup && styles.backupBtnPressed,
            ]}
            onPress={handleBackup}
            disabled={showBackup}
          >
            <Text style={styles.backupBtnLabel}>Backup</Text>
          </Pressable>

          {showBackup && privateKey && (
            <View style={styles.backupSection}>
              <Text style={styles.backupWarning}>Private Key (keep secret!)</Text>
              <View style={styles.privateKeyWrap}>
                <Text style={styles.privateKey} numberOfLines={3} selectable>
                  {privateKey}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.copyKeyBtn,
                  copiedKey && styles.copyKeyBtnDone,
                  pressed && styles.copyKeyBtnPressed,
                ]}
                onPress={handleCopyPrivateKey}
              >
                <Text style={styles.copyKeyBtnLabel}>
                  {copiedKey ? 'Copied!' : 'Copy private key'}
                </Text>
              </Pressable>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
            onPress={onClose}
          >
            <Text style={styles.doneBtnLabel}>Done</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    width: '100%',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.successDim,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  badgeText: {
    fontSize: 24,
    color: colors.success,
    fontWeight: '600',
  },
  title: {
    ...typography.title,
    fontSize: 22,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  desc: {
    ...typography.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.xl,
  },
  urlWrap: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  url: {
    ...typography.mono,
    fontSize: 13,
    color: colors.accent,
    textAlign: 'center',
  },
  copyBtn: {
    width: '100%',
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  copyBtnDone: {
    backgroundColor: colors.success,
    shadowColor: colors.success,
  },
  copyBtnPressed: {
    opacity: 0.9,
  },
  copyBtnLabel: {
    ...typography.button,
    color: '#fff',
    fontSize: 15,
  },
  backupBtn: {
    width: '100%',
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
    opacity: 0.75,
  },
  backupBtnDisabled: {
    opacity: 0.5,
  },
  backupBtnPressed: {
    opacity: 0.9,
  },
  backupBtnLabel: {
    ...typography.button,
    color: '#fff',
    fontSize: 15,
  },
  backupSection: {
    width: '100%',
    marginBottom: spacing.md,
  },
  backupWarning: {
    ...typography.caption,
    fontSize: 12,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  privateKeyWrap: {
    width: '100%',
    backgroundColor: colors.errorDim,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.error,
  },
  privateKey: {
    ...typography.mono,
    fontSize: 11,
    color: colors.text,
    textAlign: 'center',
  },
  copyKeyBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
  },
  copyKeyBtnDone: {
    backgroundColor: colors.successDim,
    borderColor: colors.success,
  },
  copyKeyBtnPressed: {
    opacity: 0.7,
  },
  copyKeyBtnLabel: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
  },
  doneBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  doneBtnPressed: {
    opacity: 0.7,
  },
  doneBtnLabel: {
    ...typography.subtitle,
    fontSize: 15,
    color: colors.textMuted,
  },
});
