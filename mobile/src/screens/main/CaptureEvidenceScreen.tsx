import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function CaptureEvidenceScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>CaptureEvidenceScreen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#f8fafc', fontSize: 18, fontWeight: '600' },
});
