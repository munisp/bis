import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import ReactNativeBiometrics from 'react-native-biometrics';
import { useDispatch } from 'react-redux';
import { setBiometricEnabled } from '../../store';

const rnBiometrics = new ReactNativeBiometrics();

export function BiometricSetupScreen({ navigation }: any) {
  const dispatch = useDispatch();

  async function setup() {
    try {
      const { keysExist } = await rnBiometrics.biometricKeysExist();
      if (!keysExist) {
        await rnBiometrics.createKeys();
      }
      dispatch(setBiometricEnabled(true));
      Alert.alert('Success', 'Biometric login enabled', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to set up biometrics');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enable Biometric Login</Text>
      <Text style={styles.subtitle}>Use fingerprint or face ID to sign in faster and more securely.</Text>
      <TouchableOpacity style={styles.btn} onPress={setup}>
        <Text style={styles.btnText}>Enable Biometrics</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.skip}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#f8fafc', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginBottom: 32 },
  btn: { backgroundColor: '#3b82f6', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 16 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skip: { textAlign: 'center', color: '#64748b', fontSize: 14 },
});
