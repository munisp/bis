/**
 * usePinFallback — React hook that provides a PIN-based authentication gate
 * for screens that require biometric confirmation but are running on a device
 * without a biometric sensor (or where the sensor is temporarily unavailable).
 *
 * Usage:
 *   const { confirmWithPin, PinModal } = usePinFallback({ subjectRef: userId });
 *
 *   // In a handler:
 *   const ok = await confirmWithPin('Approve Access');
 *   if (!ok) return; // user cancelled or wrong PIN
 *
 *   // In JSX:
 *   {PinModal}
 */

import { useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import React from 'react';
import { verifyPin } from '../services/pinFallbackApi';
import { colors, spacing, radius } from '../utils/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsePinFallbackOptions {
  /** Stable subject identifier (e.g. user UUID or employee ID) */
  subjectRef: string;
}

interface UsePinFallbackResult {
  /**
   * Show the PIN entry modal and resolve with true if the PIN is correct,
   * false if the user cancels or the PIN is wrong.
   * @param promptMessage  Shown as the modal title (e.g. "Approve Access")
   */
  confirmWithPin: (promptMessage: string) => Promise<boolean>;
  /** Render this element in your JSX to display the PIN modal */
  PinModal: React.ReactElement;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePinFallback({ subjectRef }: UsePinFallbackOptions): UsePinFallbackResult {
  const [visible, setVisible] = useState(false);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [promptMessage, setPromptMessage] = useState('Confirm with PIN');
  const [error, setError] = useState<string | null>(null);

  // Resolve/reject refs so confirmWithPin can return a Promise
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirmWithPin = useCallback((message: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPromptMessage(message);
      setPin('');
      setError(null);
      setVisible(true);
    });
  }, []);

  const handleCancel = useCallback(() => {
    setVisible(false);
    setPin('');
    setError(null);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const handleSubmit = useCallback(async () => {
    if (pin.length !== 6) {
      setError('PIN must be exactly 6 digits');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await verifyPin({ subject_ref: subjectRef, pin });
      if (result.ok) {
        setVisible(false);
        setPin('');
        resolveRef.current?.(true);
        resolveRef.current = null;
      } else {
        // Show remaining attempts or lock message
        if (result.locked_until) {
          const lockedUntil = new Date(result.locked_until).toLocaleTimeString();
          setError(`Account locked until ${lockedUntil}. Too many failed attempts.`);
        } else if (result.attempts_remaining !== undefined) {
          setError(`Incorrect PIN. ${result.attempts_remaining} attempt${result.attempts_remaining !== 1 ? 's' : ''} remaining.`);
        } else {
          setError(result.message ?? 'Incorrect PIN');
        }
        setPin('');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Verification failed: ${msg}`);
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [pin, subjectRef]);

  const PinModal = (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <Text style={styles.title}>{promptMessage}</Text>
          <Text style={styles.subtitle}>Enter your 6-digit PIN to continue</Text>

          {/* PIN input */}
          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={(text) => {
              // Only allow digits, max 6 characters
              const digits = text.replace(/\D/g, '').slice(0, 6);
              setPin(digits);
              setError(null);
            }}
            keyboardType="number-pad"
            maxLength={6}
            secureTextEntry
            placeholder="••••••"
            placeholderTextColor={colors.textMuted}
            autoFocus
            editable={!loading}
          />

          {/* PIN dots indicator */}
          <View style={styles.dotsRow}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < pin.length ? styles.dotFilled : styles.dotEmpty,
                ]}
              />
            ))}
          </View>

          {/* Error message */}
          {error && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn]}
              onPress={handleCancel}
              disabled={loading}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.confirmBtn, (loading || pin.length !== 6) && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={loading || pin.length !== 6}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmBtnText}>Confirm</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Security note */}
          <Text style={styles.securityNote}>
            🔒 PIN is verified securely. It is never stored on this device.
          </Text>
        </View>
      </View>
    </Modal>
  );

  return { confirmWithPin, PinModal };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  container: {
    backgroundColor: '#1e293b',
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  pinInput: {
    width: '100%',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.md,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotFilled: {
    backgroundColor: '#818cf8',
  },
  dotEmpty: {
    backgroundColor: '#334155',
    borderWidth: 1,
    borderColor: '#475569',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: spacing.md,
  },
  btn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: '#334155',
  },
  cancelBtnText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 14,
  },
  confirmBtn: {
    backgroundColor: '#818cf8',
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  securityNote: {
    fontSize: 11,
    color: '#475569',
    textAlign: 'center',
  },
});
