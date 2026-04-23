# BIS Mobile App

React Native mobile application for the Background Intelligence System (BIS) platform.

## Overview

The BIS Mobile App is designed for **field agents** and **analysts** who need secure, on-the-go access to the BIS platform. It provides:

- **Dashboard** — real-time alerts, open case counts, quick actions
- **Investigations** — list, view, add notes, dispatch field agents
- **Alerts** — real-time AML/fraud/compliance alerts with mark-read
- **QuickCheck** — run background vetting checks (NIN/BVN/phone) with PDF result card
- **Field Agent** — GPS-tracked dispatch, evidence capture (photo/video/document)
- **Profile** — account settings, biometric login setup, session management

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.76 |
| Navigation | React Navigation v6 (native stack + bottom tabs) |
| State | Redux Toolkit + React Query |
| Storage | MMKV (fast key-value) |
| Auth | JWT + react-native-biometrics (fingerprint/face ID) |
| Camera | react-native-camera |
| HTTP | Fetch API with automatic token injection |

## Setup

### Prerequisites

- Node.js 20+
- React Native CLI
- Android Studio (for Android) or Xcode 15+ (for iOS)
- Java 17+ (for Android)

### Installation

```bash
cd mobile
npm install

# iOS only
cd ios && pod install && cd ..
```

### Running

```bash
# Android
npm run android

# iOS
npm run ios

# Metro bundler only
npm start
```

### Environment

The app connects to the BIS API. In development (`__DEV__ === true`), it targets `http://10.0.2.2:3000/api` (Android emulator) or `http://localhost:3000/api` (iOS simulator). In production, update `BIS_API_URL` in `src/services/api.ts`.

## Architecture

```
mobile/
  src/
    App.tsx                 ← Root component with providers
    navigation/
      RootNavigator.tsx     ← Auth/main stack routing
    screens/
      auth/
        LoginScreen.tsx     ← Email/password + biometric login
        BiometricSetupScreen.tsx
      main/
        DashboardScreen.tsx ← Home with stats + alerts
        InvestigationsScreen.tsx
        InvestigationDetailScreen.tsx
        AlertsScreen.tsx
        QuickCheckScreen.tsx
        QuickCheckResultScreen.tsx
        FieldAgentScreen.tsx
        CaptureEvidenceScreen.tsx
        ProfileScreen.tsx
    services/
      api.ts                ← HTTP client with token injection
    store/
      index.ts              ← Redux store (auth, notifications)
```

## Security

- JWT tokens stored in MMKV (encrypted native storage)
- Biometric authentication via device secure enclave
- Certificate pinning recommended for production
- All API calls require Bearer token
- Jailbreak/root detection recommended for production
