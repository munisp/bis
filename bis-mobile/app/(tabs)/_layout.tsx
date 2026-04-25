/**
 * BIS Mobile — Tab Navigator Layout (v71)
 * Primary tabs: Dashboard, Alerts, AML, Cases, More
 * Secondary tabs (hidden from bar, accessible via More screen or deep links):
 *   Investigations, KYC, Screening, goAML, SAR, Documents, Payments, Reports, Biometric, Profile
 */
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const ACTIVE_COLOR = "#818cf8"; // indigo-400
const INACTIVE_COLOR = "#6b7280"; // gray-500
const TAB_BG = "#0f0f1a";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarStyle: {
          backgroundColor: TAB_BG,
          borderTopColor: "#1e1e2e",
          height: Platform.OS === "ios" ? 88 : 64,
          paddingBottom: Platform.OS === "ios" ? 28 : 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "600",
        },
        headerStyle: {
          backgroundColor: "#0a0a0f",
        },
        headerTintColor: "#e2e8f0",
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 17,
        },
      }}
    >
      {/* ── Primary tabs (always visible in bottom bar) ── */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="aml"
        options={{
          title: "AML",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="warning-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cases"
        options={{
          title: "Cases",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="folder-open-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />

      {/* ── Secondary tabs (hidden from tab bar, accessible via More screen) ── */}
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="investigations"
        options={{
          title: "Investigations",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="kyc"
        options={{
          title: "KYC",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="shield-checkmark-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="screening"
        options={{
          title: "Screening",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="goaml"
        options={{
          title: "goAML",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sar"
        options={{
          title: "SAR",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="alert-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: "Documents",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="archive-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: "Payments",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="card-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="biometric"
        options={{
          title: "Biometric",
          tabBarButton: () => null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="finger-print-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
