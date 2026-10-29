import { StyleSheet, View } from 'react-native';

import { SUCCESS } from '@/components/kit';

/**
 * A non-interactive green target box drawn over the camera preview, so the user
 * knows where to place the barcode. Each scan is registered immediately by the
 * screen's `onBarcodeScanned` handler — there's nothing to press to confirm.
 *
 * Render it as a sibling AFTER <CameraView> inside the camera container; it fills
 * the container and centres the frame. `pointerEvents="none"` lets taps/scan pass
 * through to the camera.
 */
export function ScanFrame() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.center}>
        <View style={styles.frame} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '78%',
    height: 150,
    borderWidth: 3,
    borderColor: SUCCESS,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
});
