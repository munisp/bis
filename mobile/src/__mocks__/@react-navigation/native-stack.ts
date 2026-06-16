/**
 * Minimal @react-navigation/native-stack stub for Vitest.
 */
export const createNativeStackNavigator = () => ({
  Navigator: 'Stack.Navigator',
  Screen: 'Stack.Screen',
});
export type NativeStackNavigationProp<T, K extends keyof T = keyof T> = {
  navigate: (screen: K, params?: T[K]) => void;
  goBack: () => void;
};
