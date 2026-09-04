type Listener = (state: { isConnected: boolean; isInternetReachable: boolean }) => void;

const listeners = new Set<Listener>();
let state = { isConnected: true, isInternetReachable: true };

const NetInfo = {
  fetch: async () => state,
  addEventListener: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function __setNetworkState(next: Partial<typeof state>): void {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener(state);
  }
}

export default NetInfo;
