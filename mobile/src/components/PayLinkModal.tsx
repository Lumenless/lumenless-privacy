import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRef, useEffect, useState } from 'react';
import { getPayLinkUrl } from '../services/paylink';

interface PayLinkModalProps {
  visible: boolean;
  publicKey: string | null;
  onClose: () => void;
}

export default function PayLinkModal({ visible, publicKey, onClose }: PayLinkModalProps) {
  const [copied, setCopied] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      setCopied(false);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
    }
  }, [visible]);

  const handleCopy = async () => {
    if (!publicKey) return;
    
    const url = getPayLinkUrl(publicKey);
    await Clipboard.setStringAsync(url);
    setCopied(true);
    
    // Reset after 2 seconds
    setTimeout(() => setCopied(false), 2000);
  };

  if (!publicKey) return null;

  const payUrl = getPayLinkUrl(publicKey);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.backdrop,
            { opacity: fadeAnim },
          ]}
        >
          <TouchableOpacity style={styles.backdropTouch} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.modal,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Success Icon */}
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>✓</Text>
          </View>

          <Text style={styles.title}>Pay Link Created!</Text>
          
          <Text style={styles.description}>
            Share this link with the payer. Once they pay, you'll receive it in your PrivacyCash balance.
          </Text>

          {/* URL Display */}
          <View style={styles.urlContainer}>
            <Text style={styles.urlText} numberOfLines={2}>
              {payUrl}
            </Text>
          </View>

          {/* Copy Button */}
          <TouchableOpacity
            style={[styles.copyButton, copied && styles.copyButtonSuccess]}
            onPress={handleCopy}
            activeOpacity={0.8}
          >
            <Text style={styles.copyButtonText}>
              {copied ? '✓ Copied!' : 'Copy Link'}
            </Text>
          </TouchableOpacity>

          {/* Close Button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
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
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  backdropTouch: {
    flex: 1,
  },
  modal: {
    width: '100%',
    backgroundColor: '#111',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(128, 0, 255, 0.3)',
    shadowColor: '#8000FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 10,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  icon: {
    fontSize: 32,
    color: '#00E676',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  urlContainer: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  urlText: {
    fontSize: 13,
    color: '#8000FF',
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  copyButton: {
    width: '100%',
    backgroundColor: '#8000FF',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  copyButtonSuccess: {
    backgroundColor: '#00E676',
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  closeButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  closeButtonText: {
    color: '#666',
    fontSize: 15,
    fontWeight: '600',
  },
});
