import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';

// ── Auth Slice ─────────────────────────────────────────────────────────────────

interface AuthState {
  isAuthenticated: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'analyst' | 'field_agent' | 'compliance_officer';
    agencyCode?: string;
  } | null;
  token: string | null;
  biometricEnabled: boolean;
}

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    isAuthenticated: false,
    user: null,
    token: null,
    biometricEnabled: false,
  } as AuthState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ user: AuthState['user']; token: string }>) {
      state.isAuthenticated = true;
      state.user = action.payload.user;
      state.token = action.payload.token;
    },
    logout(state) {
      state.isAuthenticated = false;
      state.user = null;
      state.token = null;
    },
    setBiometricEnabled(state, action: PayloadAction<boolean>) {
      state.biometricEnabled = action.payload;
    },
  },
});

// ── Notifications Slice ────────────────────────────────────────────────────────

interface NotificationsState {
  unreadCount: number;
  lastFetchedAt: string | null;
}

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: { unreadCount: 0, lastFetchedAt: null } as NotificationsState,
  reducers: {
    setUnreadCount(state, action: PayloadAction<number>) {
      state.unreadCount = action.payload;
    },
    markAllRead(state) {
      state.unreadCount = 0;
      state.lastFetchedAt = new Date().toISOString();
    },
  },
});

// ── Store ──────────────────────────────────────────────────────────────────────

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    notifications: notificationsSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const { setCredentials, logout, setBiometricEnabled } = authSlice.actions;
export const { setUnreadCount, markAllRead } = notificationsSlice.actions;
