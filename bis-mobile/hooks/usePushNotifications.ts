/**
 * usePushNotifications
 * Registers the device for Expo Push Notifications, persists the token in
 * AsyncStorage, and registers it with the BIS backend so the server can
 * target this device when new critical alerts or investigation status changes
 * occur.
 *
 * Usage:
 *   const { expoPushToken, notification } = usePushNotifications();
 */

import { useEffect, useRef, useState } from "react";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";

const PUSH_TOKEN_KEY = "@bis_push_token";

// Configure how notifications are handled while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface PushNotificationState {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  permissionStatus: Notifications.PermissionStatus | null;
  error: string | null;
}

export function usePushNotifications(): PushNotificationState {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<Notifications.PermissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  // tRPC mutation to register the push token with the BIS backend
  const registerTokenMutation = trpc.notifications.registerPushToken.useMutation({
    onError: (e) => console.warn("[BIS Push] Token registration failed:", e.message),
  });

  useEffect(() => {
    let isMounted = true;

    async function registerForPushNotifications() {
      if (!Device.isDevice) {
        setError("Push notifications require a physical device");
        return;
      }

      // Check / request permission
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (!isMounted) return;
      setPermissionStatus(finalStatus);

      if (finalStatus !== "granted") {
        setError("Push notification permission denied");
        return;
      }

      // Android channel setup
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("bis-alerts", {
          name: "BIS Alerts",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#EF4444",
          sound: "default",
        });
        await Notifications.setNotificationChannelAsync("bis-investigations", {
          name: "BIS Investigations",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 150, 150, 150],
          lightColor: "#3B82F6",
          sound: "default",
        });
      }

      // Get or reuse cached token
      try {
        const cachedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: "bis-platform", // matches app.json extra.eas.projectId
        });
        const token = tokenData.data;

        if (!isMounted) return;
        setExpoPushToken(token);

        // Only register with backend if token changed
        if (token !== cachedToken) {
          await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
          registerTokenMutation.mutate({
            token,
            platform: Platform.OS as "ios" | "android",
            deviceName: Device.deviceName ?? "unknown",
          });
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Token retrieval failed");
      }
    }

    registerForPushNotifications();

    // Listen for incoming notifications (foreground)
    notificationListener.current = Notifications.addNotificationReceivedListener((n) => {
      if (isMounted) setNotification(n);
    });

    // Listen for notification interactions (tap to open)
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      console.log("[BIS Push] Notification tapped:", data);
      // Navigation can be wired here via expo-router:
      // if (data.type === "alert") router.push(`/alerts/${data.id}`);
      // if (data.type === "investigation") router.push(`/investigations/${data.ref}`);
    });

    return () => {
      isMounted = false;
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  return { expoPushToken, notification, permissionStatus, error };
}

/**
 * Helper: send a local notification immediately (useful for testing).
 */
export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId = "bis-alerts"
) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {}, sound: "default" },
    trigger: null, // immediate
    ...(Platform.OS === "android" ? { channelId } : {}),
  } as Notifications.NotificationRequestInput);
}
