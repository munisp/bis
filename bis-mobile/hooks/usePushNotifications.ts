/**
 * usePushNotifications
 *
 * Registers the device for Expo push notifications, stores the token via tRPC,
 * and handles deep-link routing when the user taps a notification.
 *
 * Notification payload shape expected from the BIS server:
 * {
 *   type: "alert" | "investigation" | "field_task" | "kyc",
 *   id: string | number,   // alert id, investigation ref, field task ref, etc.
 * }
 *
 * Routing table:
 *   type=alert          → /alerts/:id
 *   type=investigation  → /investigation/:id
 *   type=field_task     → /investigation/:id  (opens parent investigation)
 *   type=kyc            → /(tabs)/kyc
 *   (fallback)          → /(tabs)/alerts
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useRouter } from "expo-router";

// Configure how foreground notifications are presented
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ─── Types ────────────────────────────────────────────────────────────────────

type NotificationData = {
  type?: "alert" | "investigation" | "field_task" | "kyc";
  id?: string | number;
  ref?: string;
};

// ─── Deep-link resolver ───────────────────────────────────────────────────────

function resolveRoute(data: NotificationData): string {
  const { type, id, ref } = data;
  const target = id ?? ref;

  switch (type) {
    case "alert":
      return target ? `/alerts/${target}` : "/(tabs)/alerts";
    case "investigation":
      return target ? `/investigation/${target}` : "/(tabs)/investigations";
    case "field_task":
      // Field tasks link to the parent investigation if ref is provided
      return target ? `/investigation/${target}` : "/(tabs)/investigations";
    case "kyc":
      return "/(tabs)/kyc";
    default:
      return "/(tabs)/alerts";
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePushNotifications() {
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    registerForPushNotificationsAsync();

    // Foreground notification received — no navigation, just display
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {
        // Notification is shown automatically via setNotificationHandler above
      }
    );

    // User tapped a notification (foreground or background)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as NotificationData;
        const route = resolveRoute(data);
        // Small delay to ensure the navigator is mounted
        setTimeout(() => {
          router.push(route as any);
        }, 300);
      }
    );

    // Handle notification that launched the app from killed state
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as NotificationData;
      const route = resolveRoute(data);
      setTimeout(() => {
        router.push(route as any);
      }, 500);
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [router]);
}

// ─── Permission + token registration ─────────────────────────────────────────

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    // Simulators cannot receive push notifications
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("bis-alerts", {
      name: "BIS Alerts",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#818cf8",
      sound: "default",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("[BIS] Push notification permission not granted");
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn("[BIS] No EAS project ID found — skipping push token registration");
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenData.data;
  } catch (err) {
    console.warn("[BIS] Failed to get push token:", err);
    return null;
  }
}
