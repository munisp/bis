/**
 * Minimal @react-navigation/native stub for Vitest.
 */
export const useNavigation = () => ({
  navigate: () => {},
  goBack: () => {},
  push: () => {},
  replace: () => {},
});
export const useRoute = () => ({
  params: { kycRecordId: 'test-kyc-001', id: 'test-001', investigationId: 'inv-001' },
});
export const useIsFocused = () => true;
export const NavigationContainer = 'NavigationContainer';
export const RouteProp = {};
