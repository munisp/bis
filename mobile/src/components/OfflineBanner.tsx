/**
 * OfflineBanner — React Native component that shows a persistent banner
 * when the device is offline or when there are pending queued operations.
 *
 * Features:
 * - Detects network state via NetInfo
 * - Shows pending operation count with a retry button
 * - Animates in/out smoothly
 * - Accessible (accessibilityRole, accessibilityLiveRegion)
 *
 * Usage (in App.tsx or RootNavigator.tsx):
 *   <OfflineBanner />
 *   <NavigationContainer>...</NavigationContainer>
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

// ─── NetInfo shim ─────────────────────────────────────────────────────────────
// We use a lightweight shim so the component compiles in environments where
// @react-native-community/netinfo is not installed (e.g. unit tests).

type NetInfoState = { isConnected: boolean | null };
type NetInfoUnsubscribe = () => void;

interface NetInfoModule {
  fetch(): Promise<NetInfoState>;
  addEventListener(listener: (state: NetInfoState) => void): NetInfoUnsubscribe;
}

function getNetInfo(): NetInfoModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@react-native-community/netinfo').default as NetInfoModule;
  } catch {
    // Fallback shim — assumes online
    return {
      fetch: async () => ({ isConnected: true }),
      addEventListener: () => () => {},
    };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface OfflineBannerProps {
  /** Override the background colour (default: '#EF4444' for offline, '#F59E0B' for pending). */
  offlineColor?: string;
  pendingColor?: string;
  /** Height of the banner in pixels (default: 36). */
  height?: number;
}

export function OfflineBanner({
  offlineColor = '#EF4444',
  pendingColor = '#F59E0B',
  height = 36,
}: OfflineBannerProps) {
  const { pending, drain, isDraining } = useOfflineQueue();
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const slideAnim = useRef(new Animated.Value(-height)).current;

  // Fetch initial network state
  useEffect(() => {
    const netInfo = getNetInfo();
    netInfo.fetch().then(state => setIsConnected(state.isConnected ?? true));
    const unsubscribe = netInfo.addEventListener(state => {
      setIsConnected(state.isConnected ?? true);
    });
    return unsubscribe;
  }, [height]);

  const isOffline = isConnected === false;
  const hasPending = pending > 0;
  const shouldShow = isOffline || hasPending;

  // Slide in/out animation
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: shouldShow ? 0 : -height,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [shouldShow, slideAnim, height]);

  // Announce to screen readers when going offline
  useEffect(() => {
    if (isOffline) {
      AccessibilityInfo.announceForAccessibility(
        'You are offline. Changes will be saved and synced when you reconnect.'
      );
    }
  }, [isOffline]);

  // Auto-drain when coming back online
  useEffect(() => {
    if (isConnected && hasPending) {
      drain();
    }
  }, [isConnected, hasPending, drain]);

  const handleRetry = useCallback(() => {
    drain();
  }, [drain]);

  const bannerColor = isOffline ? offlineColor : pendingColor;

  const label = isOffline
    ? pending > 0
      ? `Offline — ${pending} operation${pending !== 1 ? 's' : ''} queued`
      : 'You are offline'
    : `Syncing ${pending} pending operation${pending !== 1 ? 's' : ''}…`;

  return (
    <Animated.View
      style={[
        styles.container,
        { height, backgroundColor: bannerColor, transform: [{ translateY: slideAnim }] },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      <View style={styles.content}>
        {/* Status dot */}
        <View style={[styles.dot, isOffline ? styles.dotOffline : styles.dotPending]} />

        {/* Label */}
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>

        {/* Retry button (only when online with pending items) */}
        {!isOffline && hasPending && (
          <TouchableOpacity
            onPress={handleRetry}
            disabled={isDraining}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry sync"
            accessibilityState={{ disabled: isDraining }}
          >
            <Text style={styles.retryText}>{isDraining ? 'Syncing…' : 'Retry'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    zIndex: 9999,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotOffline: {
    backgroundColor: '#fff',
  },
  dotPending: {
    backgroundColor: '#fff',
    opacity: 0.8,
  },
  text: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '500',
  },
  retryButton: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  retryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
