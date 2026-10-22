import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, DANGER, PRIMARY, SUCCESS } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

/** How long a toast stays on screen before it auto-dismisses. */
const TOAST_DURATION = 2500;

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
  /** Render the confirm button in a destructive (danger) style. */
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

interface ToastState extends ToastOptions {
  /** Monotonic id so re-firing the same message restarts the timer. */
  id: number;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Styled, themed replacement for `Alert.alert`:
 *   - `useToast()`  → auto-dismissing animated card near the bottom.
 *   - `useConfirm()` → promise-based confirmation dialog in a modal.
 *
 * Self-contained and RN-only. Must wrap any screens that call the hooks and
 * sit inside the i18n provider so default button labels can be localized.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const nextId = useRef(0);

  const toast = useCallback((opts: ToastOptions) => {
    setToastState({ ...opts, id: nextId.current++ });
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ ...opts, resolve });
      }),
    [],
  );

  const dismissToast = useCallback(() => setToastState(null), []);

  const closeConfirm = useCallback((value: boolean) => {
    setConfirmState((prev) => {
      prev?.resolve(value);
      return null;
    });
  }, []);

  const value = useMemo<FeedbackContextValue>(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ToastCard state={toastState} onDismiss={dismissToast} />
      <ConfirmDialog state={confirmState} onClose={closeConfirm} />
    </FeedbackContext.Provider>
  );
}

/** Animated, color-coded toast card anchored near the bottom of the screen. */
function ToastCard({
  state,
  onDismiss,
}: {
  state: ToastState | null;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        if (!cancelled) onDismiss();
      });
    }, TOAST_DURATION);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, anim, onDismiss]);

  if (!state) return null;

  const accent = TOAST_COLORS[state.type];
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  return (
    <View
      pointerEvents="box-none"
      style={[styles.toastLayer, { paddingBottom: insets.bottom + Spacing.four }]}
    >
      <Animated.View style={{ opacity: anim, transform: [{ translateY }], width: '100%' }}>
        <Pressable onPress={onDismiss}>
          <View
            style={[
              styles.toastCard,
              { backgroundColor: theme.backgroundElement, borderLeftColor: accent },
            ]}
          >
            {state.title ? (
              <ThemedText type="smallBold" style={{ color: accent }}>
                {state.title}
              </ThemedText>
            ) : null}
            <ThemedText type="small" style={{ color: theme.text }}>
              {state.message}
            </ThemedText>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Promise-backed confirmation dialog rendered in a dimmed modal. */
function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: (value: boolean) => void;
}) {
  const t = useT();
  const visible = state != null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onClose(false)}
    >
      <Pressable style={styles.backdrop} onPress={() => onClose(false)}>
        {/* Swallow presses on the card so tapping it doesn't dismiss. */}
        <Pressable style={styles.dialogWrap} onPress={() => {}}>
          <Card style={styles.dialogCard}>
            {state ? (
              <>
                <ThemedText type="smallBold">{state.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {state.message}
                </ThemedText>
                <View style={styles.dialogButtons}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={state.cancelText ?? t('common.cancel', 'Cancel')}
                      variant="secondary"
                      onPress={() => onClose(false)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={state.confirmText ?? t('common.ok', 'OK')}
                      variant={state.destructive ? 'danger' : 'primary'}
                      onPress={() => onClose(true)}
                    />
                  </View>
                </View>
              </>
            ) : null}
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function useToast(): (opts: ToastOptions) => void {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useToast must be used within a FeedbackProvider');
  return ctx.toast;
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useConfirm must be used within a FeedbackProvider');
  return ctx.confirm;
}

const styles = StyleSheet.create({
  toastLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  toastCard: {
    width: '100%',
    borderRadius: Spacing.three,
    borderLeftWidth: 4,
    padding: Spacing.three,
    gap: Spacing.half,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#00000088',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  dialogWrap: { width: '100%', maxWidth: 400 },
  dialogCard: { gap: Spacing.three },
  dialogButtons: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
});
