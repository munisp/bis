import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function QuickCheckResultScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>QuickCheckResultScreen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#f8fafc', fontSize: 18, fontWeight: '600' },
});
