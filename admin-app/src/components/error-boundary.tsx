import { logError } from '@common';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  children: ReactNode;
  /** Shown above the message; defaults to a generic apology. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a thrown component shows a recoverable screen instead of a
 * blank white app, and reports them through the shared logger.
 *
 * Deliberately styled with raw RN primitives and literal colours: this must render even if
 * the theme, i18n or auth providers are the thing that just blew up.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError('render', error, { componentStack: info.componentStack?.slice(0, 2000) });
  }

  private readonly reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.wrap}>
        <Text style={styles.emoji}>😵</Text>
        <Text style={styles.title}>{this.props.label ?? 'Something went wrong'}</Text>
        <Text style={styles.body}>
          The screen hit an unexpected error. It has been reported. You can try again — if it
          keeps happening, close and reopen the app.
        </Text>
        <ScrollView style={styles.detailBox} contentContainerStyle={{ padding: 10 }}>
          <Text style={styles.detail}>{error.message}</Text>
        </ScrollView>
        <TouchableOpacity style={styles.button} onPress={this.reset} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#ffffff' },
  emoji: { fontSize: 44 },
  title: { fontSize: 18, fontWeight: '700', color: '#141414', textAlign: 'center' },
  body: { fontSize: 14, color: '#555555', textAlign: 'center', lineHeight: 20 },
  detailBox: { maxHeight: 120, alignSelf: 'stretch', backgroundColor: '#f3f3f3', borderRadius: 8 },
  detail: { fontSize: 12, color: '#8a1c1c', fontFamily: 'monospace' },
  button: { backgroundColor: '#208AEF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999, marginTop: 4 },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
});
