import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import "react-native-reanimated";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { TRPCProvider } from "@/lib/trpc";

// Prevent the splash screen from auto-hiding until the root navigator is ready.
void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  usePushNotifications();

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="kyc/camera" options={{ title: "Document Capture", presentation: "modal" }} />
        <Stack.Screen name="kyc/biometric" options={{ title: "Biometric Enrollment", presentation: "modal" }} />
        <Stack.Screen name="investigation/[id]" options={{ title: "Investigation Detail" }} />
        <Stack.Screen name="alerts/[id]" options={{ title: "Alert Detail" }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <TRPCProvider>
      <RootNavigator />
    </TRPCProvider>
  );
}
