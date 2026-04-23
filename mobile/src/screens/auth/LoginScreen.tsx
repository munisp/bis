/**
 * Login Screen — Email/password + biometric authentication.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useDispatch } from 'react-redux';
import ReactNativeBiometrics from 'react-native-biometrics';
import { setCredentials } from '../../store';
import { authApi, setStoredToken, getStoredToken } from '../../services/api';

const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

export function LoginScreen() {
  const dispatch = useDispatch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password');
      return;
    }
    setLoading(true);
    try {
      const result = await authApi.login(email, password);
      setStoredToken(result.token);
      dispatch(setCredentials({ user: result.user as any, token: result.token }));
    } catch (err: any) {
      Alert.alert('Login Failed', err.message ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  async function handleBiometricLogin() {
    try {
      const { available, biometryType } = await rnBiometrics.isSensorAvailable();
      if (!available) {
        Alert.alert('Not Available', 'Biometric authentication is not available on this device');
        return;
      }

      const { success, signature } = await rnBiometrics.createSignature({
        promptMessage: `Sign in with ${biometryType}`,
        payload: `bis-login-${Date.now()}`,
      });

      if (success && signature) {
        setLoading(true);
        const result = await authApi.biometricLogin('bis-login-challenge', signature);
        setStoredToken(result.token);
        dispatch(setCredentials({ user: result.user as any, token: result.token }));
      }
    } catch (err: any) {
      Alert.alert('Biometric Error', err.message ?? 'Biometric authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <View style={styles.logoContainer}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>BIS</Text>
          </View>
          <Text style={styles.title}>Background Intelligence System</Text>
          <Text style={styles.subtitle}>Secure Field Agent & Analyst Portal</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email address"
            placeholderTextColor="#64748b"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#64748b"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.biometricBtn} onPress={handleBiometricLogin}>
            <Text style={styles.biometricBtnText}>Use Biometrics</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>
          Authorised personnel only. All access is logged and monitored.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  logoContainer: { alignItems: 'center', marginBottom: 40 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: { fontSize: 24, fontWeight: '900', color: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#f8fafc', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4, textAlign: 'center' },
  form: { gap: 12 },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    color: '#f8fafc',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  loginBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  biometricBtn: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  biometricBtnText: { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
  footer: { textAlign: 'center', color: '#475569', fontSize: 11, marginTop: 32 },
});
