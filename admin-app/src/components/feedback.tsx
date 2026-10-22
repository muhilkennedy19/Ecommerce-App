// Styled, themed replacements for `Alert.alert` — a bottom toast and a modal
// confirm dialog. Self-contained (React Native only): Animated for the toast
// transition, Modal for the dialog. Exposed through <FeedbackProvider> plus the
// `useToast()` and `useConfirm()` hooks.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, DANGER, PRIMARY, SUCCESS } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  type: ToastType;
  message: string;
  title?: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface FeedbackContextValue {
  toast: (opts: ToastOptions) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | undefined>(undefined);

const TOAST_COLORS: Record<ToastType, string> = {
  success: SUCCESS,
  error: DANGER,
  info: PRIMARY,
};

const TOAST_DURATION = 2500;

export function FeedbackProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toastState, setToastState] = useState<ToastOptions | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);

  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const hideToast = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) setToastState(null);
      },
    );
  }, [anim]);

  const toast = useCallback(
    (opts: ToastOptions) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToastState(opts);
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(hideToast, TOAST_DURATION);
    },
    [anim, hideToast],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setConfirmState(opts);
      }),
    [],
  );

  const settleConfirm = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setConfirmState(null);
  }, []);

  const value = useMemo<FeedbackContextValue>(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ToastHost toast={toastState} anim={anim} onDismiss={hideToast} />
      <ConfirmHost options={confirmState} onResult={settleConfirm} />
    </FeedbackContext.Provider>
  );
}

function ToastHost({
  toast,
  anim,
  onDismiss,
}: Readonly<{ toast: ToastOptions | null; anim: Animated.Value; onDismiss: () => void }>) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  if (!toast) return null;
  const accent = TOAST_COLORS[toast.type];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.toastWrap,
        {
          bottom: insets.bottom + Spacing.four,
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onDismiss}
        style={[
          styles.toastCard,
          { backgroundColor: theme.backgroundElement, borderLeftColor: accent },
        ]}
      >
        {toast.title ? (
          <ThemedText type="smallBold" style={{ color: accent }}>
            {toast.title}
          </ThemedText>
        ) : null}
        <ThemedText type="small">{toast.message}</ThemedText>
      </Pressable>
    </Animated.View>
  );
}

function ConfirmHost({
  options,
  onResult,
}: Readonly<{ options: ConfirmOptions | null; onResult: (result: boolean) => void }>) {
  const theme = useTheme();
  const t = useT();
  const destructive = !!options?.destructive;

  return (
    <Modal
      visible={!!options}
      transparent
      animationType="fade"
      onRequestClose={() => onResult(false)}
    >
      <Pressable style={styles.backdrop} onPress={() => onResult(false)}>
        {/* Inner press is swallowed so taps on the card don't dismiss the dialog. */}
        <Pressable
          style={[styles.dialog, { backgroundColor: theme.backgroundElement }]}
          onPress={() => {}}
        >
          {options ? (
            <>
              <ThemedText type="smallBold" style={styles.dialogTitle}>
                {options.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {options.message}
              </ThemedText>
              <View style={styles.dialogActions}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={options.cancelText ?? t('common.cancel', 'Cancel')}
                    variant="secondary"
                    onPress={() => onResult(false)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title={options.confirmText ?? t('common.continue', 'Continue')}
                    variant={destructive ? 'danger' : 'primary'}
                    onPress={() => onResult(true)}
                  />
                </View>
              </View>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function useToast(): (opts: ToastOptions) => void {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useToast must be used within <FeedbackProvider>');
  return ctx.toast;
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useConfirm must be used within <FeedbackProvider>');
  return ctx.confirm;
}

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
  },
  toastCard: {
    borderRadius: Spacing.three,
    borderLeftWidth: 4,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  dialogTitle: { fontSize: 18, lineHeight: 24 },
  dialogActions: { flexDirection: 'row', gap: Spacing.two },
});
