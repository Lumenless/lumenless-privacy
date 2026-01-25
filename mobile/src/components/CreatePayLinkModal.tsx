import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRef, useEffect, useState } from 'react';
import { colors, spacing, radius, typography } from '../theme';

interface CreatePayLinkModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (title?: string) => Promise<void>;
  creating: boolean;
}

export default function CreatePayLinkModal({
  visible,
  onClose,
  onCreate,
  creating,
}: CreatePayLinkModalProps) {
  const [title, setTitle] = useState('');
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (visible) {
      setTitle('');
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 10, tension: 90, useNativeDriver: true }),
      ]).start();
    } else {
      fade.setValue(0);
      scale.setValue(0.92);
    }
  }, [visible]);

  const handleCreate = async () => {
    await onCreate(title.trim() || undefined);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
          <Text style={styles.heading}>New pay link</Text>
          <Text style={styles.hint}>Add an optional title to identify this link.</Text>

          <TextInput
            style={styles.input}
            placeholder="Title (optional)"
            placeholderTextColor={colors.textMuted}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
            editable={!creating}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.createBtn,
                creating && styles.createBtnDisabled,
                pressed && !creating && styles.createBtnPressed,
              ]}
              onPress={handleCreate}
              disabled={creating}
            >
              <Text style={styles.createBtnLabel}>
                {creating ? 'Creating…' : 'Create'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.cancelBtnPressed]}
              onPress={onClose}
              disabled={creating}
            >
              <Text style={styles.cancelBtnLabel}>Cancel</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
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
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  heading: {
    ...typography.title,
    fontSize: 22,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  hint: {
    ...typography.body,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actions: {
    gap: spacing.md,
  },
  createBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  createBtnDisabled: {
    opacity: 0.7,
  },
  createBtnPressed: {
    opacity: 0.9,
  },
  createBtnLabel: {
    ...typography.button,
    color: '#fff',
    fontSize: 15,
  },
  cancelBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnPressed: {
    opacity: 0.7,
  },
  cancelBtnLabel: {
    ...typography.subtitle,
    fontSize: 15,
    color: colors.textMuted,
  },
});
