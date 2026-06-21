/**
 * Root Navigator — handles auth state and routes to the correct stack.
 *
 * Unauthenticated: AuthStack (Login, Biometric Setup)
 * Authenticated: MainTabs (Dashboard, Investigations, Alerts, QuickCheck, InsiderThreat, Profile)
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';

// Auth screens
import { LoginScreen } from '../screens/auth/LoginScreen';
import { BiometricSetupScreen } from '../screens/auth/BiometricSetupScreen';

// Main screens
import { DashboardScreen } from '../screens/main/DashboardScreen';
import { InvestigationsScreen } from '../screens/main/InvestigationsScreen';
import { InvestigationDetailScreen } from '../screens/main/InvestigationDetailScreen';
import { AlertsScreen } from '../screens/main/AlertsScreen';
import { QuickCheckScreen } from '../screens/main/QuickCheckScreen';
import { QuickCheckResultScreen } from '../screens/main/QuickCheckResultScreen';
import { ProfileScreen } from '../screens/main/ProfileScreen';
import { FieldAgentScreen } from '../screens/main/FieldAgentScreen';
import { CaptureEvidenceScreen } from '../screens/main/CaptureEvidenceScreen';
import { KYCDocumentCaptureScreen } from '../screens/main/KYCDocumentCaptureScreen';

// Insider Threat screens
import { InsiderThreatScreen } from '../screens/main/InsiderThreatScreen';
import { UEBAScreen } from '../screens/main/UEBAScreen';
import { AccessReviewScreen } from '../screens/main/AccessReviewScreen';

export type AuthStackParamList = {
  Login: undefined;
  BiometricSetup: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Investigations: undefined;
  Alerts: undefined;
  QuickCheck: undefined;
  InsiderThreat: undefined;
  Profile: undefined;
};

export type InvestigationsStackParamList = {
  InvestigationsList: undefined;
  InvestigationDetail: { id: string };
  FieldAgent: { investigationId: string };
  CaptureEvidence: { investigationId: string };
  KYCDocumentCapture: { kycRecordId: string };
};

export type QuickCheckStackParamList = {
  QuickCheckForm: undefined;
  QuickCheckResult: { requestId: string };
};

export type InsiderThreatStackParamList = {
  InsiderThreatEvents: undefined;
  UEBAProfiles: undefined;
  AccessReviews: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const InvestigationsStack = createNativeStackNavigator<InvestigationsStackParamList>();
const QuickCheckStack = createNativeStackNavigator<QuickCheckStackParamList>();
const InsiderThreatStack = createNativeStackNavigator<InsiderThreatStackParamList>();

function InvestigationsNavigator() {
  return (
    <InvestigationsStack.Navigator>
      <InvestigationsStack.Screen
        name="InvestigationsList"
        component={InvestigationsScreen}
        options={{ title: 'Investigations' }}
      />
      <InvestigationsStack.Screen
        name="InvestigationDetail"
        component={InvestigationDetailScreen}
        options={{ title: 'Investigation Detail' }}
      />
      <InvestigationsStack.Screen
        name="FieldAgent"
        component={FieldAgentScreen}
        options={{ title: 'Field Agent Dispatch' }}
      />
      <InvestigationsStack.Screen
        name="CaptureEvidence"
        component={CaptureEvidenceScreen}
        options={{ title: 'Capture Evidence' }}
      />
      <InvestigationsStack.Screen
        name="KYCDocumentCapture"
        component={KYCDocumentCaptureScreen}
        options={{ title: 'KYC Document Capture' }}
      />
    </InvestigationsStack.Navigator>
  );
}

function QuickCheckNavigator() {
  return (
    <QuickCheckStack.Navigator>
      <QuickCheckStack.Screen
        name="QuickCheckForm"
        component={QuickCheckScreen}
        options={{ title: 'QuickCheck' }}
      />
      <QuickCheckStack.Screen
        name="QuickCheckResult"
        component={QuickCheckResultScreen}
        options={{ title: 'Vetting Result' }}
      />
    </QuickCheckStack.Navigator>
  );
}

function InsiderThreatNavigator() {
  return (
    <InsiderThreatStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#f8fafc',
      }}
    >
      <InsiderThreatStack.Screen
        name="InsiderThreatEvents"
        component={InsiderThreatScreen}
        options={{ title: 'Insider Threat' }}
      />
      <InsiderThreatStack.Screen
        name="UEBAProfiles"
        component={UEBAScreen}
        options={{ title: 'UEBA Profiles' }}
      />
      <InsiderThreatStack.Screen
        name="AccessReviews"
        component={AccessReviewScreen}
        options={{ title: 'Access Reviews' }}
      />
    </InsiderThreatStack.Navigator>
  );
}

function MainNavigator() {
  return (
    <MainTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#f8fafc',
      }}
    >
      <MainTab.Screen name="Dashboard" component={DashboardScreen} />
      <MainTab.Screen name="Investigations" component={InvestigationsNavigator} />
      <MainTab.Screen name="Alerts" component={AlertsScreen} />
      <MainTab.Screen name="QuickCheck" component={QuickCheckNavigator} />
      <MainTab.Screen
        name="InsiderThreat"
        component={InsiderThreatNavigator}
        options={{ title: 'Insider Threat', tabBarLabel: 'Insider' }}
      />
      <MainTab.Screen name="Profile" component={ProfileScreen} />
    </MainTab.Navigator>
  );
}

export function RootNavigator() {
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);

  if (!isAuthenticated) {
    return (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="Login" component={LoginScreen} />
        <AuthStack.Screen name="BiometricSetup" component={BiometricSetupScreen} />
      </AuthStack.Navigator>
    );
  }

  return <MainNavigator />;
}
