/**
 * BIS Mobile App — Root Component
 *
 * Architecture:
 * - React Navigation v6 with bottom tabs + native stack
 * - Redux Toolkit for global state (auth, notifications)
 * - React Query for server state (investigations, alerts, etc.)
 * - MMKV for fast local storage (session tokens, offline cache)
 * - Biometric authentication via react-native-biometrics
 */

import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as ReduxProvider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { store } from './store';
import { RootNavigator } from './navigation/RootNavigator';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
    },
  },
});

export default function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ReduxProvider store={store}>
          <QueryClientProvider client={queryClient}>
            <NavigationContainer>
              <StatusBar
                barStyle={isDarkMode ? 'light-content' : 'dark-content'}
                backgroundColor={isDarkMode ? '#0f172a' : '#ffffff'}
              />
              <RootNavigator />
            </NavigationContainer>
          </QueryClientProvider>
        </ReduxProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
