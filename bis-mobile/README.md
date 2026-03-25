# BIS Mobile — React Native / Expo Shell

**Background Intelligence System** mobile companion app built with Expo Router (file-based routing), tRPC for end-to-end type-safe API calls to the BIS BFF, and a full biometric enrollment flow with camera capture.

---

## Architecture

```
bis-mobile/
  app/
    _layout.tsx              ← Root layout (TRPCProvider, ThemeProvider, Stack)
    (tabs)/
      _layout.tsx            ← Bottom tab navigator
      index.tsx              ← Dashboard (stats, quick actions, recent alerts)
      investigations.tsx     ← Investigations list with search
      kyc.tsx                ← KYC records + quick actions
      alerts.tsx             ← Open alerts with acknowledge action
      profile.tsx            ← User profile + sign out
    kyc/
      biometric.tsx          ← 5-step biometric enrollment (liveness + selfie + doc)
      camera.tsx             ← Document capture + OCR via tRPC
    investigation/
      [id].tsx               ← Investigation detail (TODO: implement)
  components/                ← Shared UI components
  hooks/
    useAuth.ts               ← Auth state from trpc.auth.me
  lib/
    trpc.ts                  ← tRPC client + TRPCProvider
  assets/                    ← Icons, splash, fonts
```

---

## Quick Start

```bash
cd bis-mobile
npm install   # or: pnpm install
npx expo start
```

Scan the QR code with **Expo Go** (iOS/Android) or press `i` for iOS simulator / `a` for Android emulator.

---

## tRPC Integration

The mobile app shares the **same AppRouter type** as the BFF (`../../server/routers.ts`), giving full end-to-end type safety without any manual API contract files.

```ts
// lib/trpc.ts
import type { AppRouter } from "../../server/routers";
export const trpc = createTRPCReact<AppRouter>();
```

The BFF URL defaults to `http://localhost:3001` for local development. Override with the `BIS_BFF_URL` environment variable for staging/production.

---

## Biometric Enrollment Flow

The `app/kyc/biometric.tsx` screen implements a 5-step enrollment:

| Step | Description |
|------|-------------|
| 1. Permissions | Request camera access |
| 2. Liveness | Blink + head-turn challenges via `trpc.biometric.getChallenges` |
| 3. Selfie | Front camera capture with face oval overlay |
| 4. Document | Rear camera capture with document frame overlay (NIN / passport / licence) |
| 5. Confirm | Preview + submit via `trpc.biometric.fullEnrollment` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BIS_BFF_URL` | `http://localhost:3001` | BIS BFF base URL |

---

## Build for Production

```bash
# EAS Build (recommended)
npx eas build --platform ios
npx eas build --platform android

# Local build
npx expo run:ios
npx expo run:android
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `expo-router` | File-based navigation |
| `expo-camera` | Camera capture for biometric/document |
| `expo-image-picker` | Gallery document upload |
| `expo-haptics` | Tactile feedback |
| `expo-secure-store` | Secure session token storage |
| `@trpc/react-query` | Type-safe API calls to BFF |
| `@tanstack/react-query` | Server state management |
| `superjson` | Date/BigInt serialization |
