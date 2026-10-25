import { Spacing } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const PRIMARY = '#208AEF';
export const DANGER = '#E5484D';
export const SUCCESS = '#30A46C';

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const inner = (
    <View style={[styles.screenInner, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>{children}</View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
      {String(children).toUpperCase()}
    </ThemedText>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'md' | 'sm';
  loading?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const bg =
    variant === 'primary' ? PRIMARY : variant === 'danger' ? DANGER : theme.backgroundSelected;
  const color = variant === 'secondary' ? theme.text : '#ffffff';
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : null,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} size={size === 'sm' ? 'small' : undefined} />
      ) : (
        <ThemedText style={[styles.buttonText, size === 'sm' ? styles.buttonTextSm : null, { color }]}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  style,
  ...props
}: TextInputProps & { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      {label ? (
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
          style,
        ]}
        {...props}
      />
    </View>
  );
}

export function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: PRIMARY }} />
    </View>
  );
}

export function Badge({ label, color }: { label: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: (color ?? PRIMARY) + '22' }]}>
      <ThemedText type="small" style={{ color: color ?? PRIMARY }}>
        {label}
      </ThemedText>
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card style={{ alignItems: 'center', gap: Spacing.two }}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {hint}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const LOADER_EMOJIS = ['🍓', '🌸', '🍊'] as const;

/** A single bouncing/fading emoji dot in the themed loader. */
function LoaderDot({ emoji, delay }: { emoji: string; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 320, useNativeDriver: true }),
        Animated.delay(360 - delay),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <Animated.Text style={[styles.loaderDot, { opacity, transform: [{ translateY }] }]}>
      {emoji}
    </Animated.Text>
  );
}

/** Centered, themed loading indicator: bouncing emoji dots with an optional label. */
export function Loader({ label }: { label?: string }) {
  return (
    <View style={styles.loader}>
      <View style={styles.loaderRow}>
        {LOADER_EMOJIS.map((emoji, i) => (
          <LoaderDot key={emoji} emoji={emoji} delay={i * 140} />
        ))}
      </View>
      {label ? (
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screenInner: { padding: Spacing.three, gap: Spacing.three, flex: 1 },
  scrollContent: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  sectionTitle: { marginTop: Spacing.two, letterSpacing: 0.5 },
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontWeight: '700' },
  buttonSm: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.one + 2,
  },
  buttonTextSm: { fontSize: 13, lineHeight: 18 },
  field: { gap: Spacing.one },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 16,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  loader: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  loaderRow: { flexDirection: 'row', gap: Spacing.two, height: 34, alignItems: 'flex-end' },
  loaderDot: { fontSize: 26 },
});
