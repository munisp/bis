/**
 * Minimal react-native stub for Vitest.
 * Only stubs the exports used by the modules under test.
 * Component stubs are plain objects/functions — no rendering needed.
 */

export const View = 'View';
export const Text = 'Text';
export const StyleSheet = {
  create: (styles: Record<string, unknown>) => styles,
  flatten: (style: unknown) => style,
};
export const TouchableOpacity = 'TouchableOpacity';
export const ScrollView = 'ScrollView';
export const Image = 'Image';
export const Alert = {
  alert: () => {},
};
export const ActivityIndicator = 'ActivityIndicator';
export const Platform = {
  OS: 'ios' as const,
  select: (obj: Record<string, unknown>) => obj.ios ?? obj.default,
};
export const Dimensions = {
  get: () => ({ width: 375, height: 812 }),
};
export const Animated = {
  Value: class {
    constructor(public _value: number) {}
  },
  timing: () => ({ start: () => {} }),
  spring: () => ({ start: () => {} }),
  View: 'Animated.View',
};
export const useWindowDimensions = () => ({ width: 375, height: 812 });
export const useColorScheme = () => 'dark';
