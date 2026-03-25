import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import "react-native-reanimated";
import { TRPCProvider } from "@/lib/trpc";
import { usePushNotifications } from "@/hooks/usePushNotifications";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  // Activate push notification listener + deep-link routing
  usePushNotifications();

  return (
    <TRPCProvider>
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
    </TRPCProvider>
  );
}
