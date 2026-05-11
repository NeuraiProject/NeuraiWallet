/**
 * Push notifications stub.
 *
 * NeuraiWallet shipped with `react-native-notifications` + a self-hosted
 * GroundControl backend, plus FCM (Firebase) on Android. NeuraiWallet does
 * not have a Firebase project yet, so calling FCM crashes the process at
 * startup with `Default FirebaseApp is not initialized`. Until we wire up a
 * Neurai-owned push backend (or drop the feature for good), all callers
 * resolve to no-ops here so the rest of the app keeps compiling and running.
 */

export const NOTIFICATIONS_NO_AND_DONT_ASK_FLAG = 'NOTIFICATIONS_NO_AND_DONT_ASK_FLAG';

export type TPushToken = { token: string; os: string };
export type TPayload = {
  foreground?: boolean;
  userInteraction?: boolean;
  type: string | number;
  address: string;
  txid: string;
  hash: string;
  [key: string]: any;
};

export const isNotificationsCapable = false;

export const checkNotificationPermissionStatus = async (): Promise<string> => 'denied';
export const cleanUserOptOutFlag = async (): Promise<void> => {};
export const tryToObtainPermissions = async (): Promise<boolean> => false;
export const majorTomToGroundControl = async (
  _addresses: string[],
  _hashes: string[],
  _txids: string[],
): Promise<void> => {};
export const checkPermissions = async (): Promise<{ granted: boolean }> => ({ granted: false });
export const setLevels = async (_levelAll: boolean): Promise<void> => {};
export const addNotification = async (_notification: TPayload): Promise<void> => {};
export const isGroundControlUriValid = async (_uri: string): Promise<boolean> => false;
export const getPushToken = async (): Promise<TPushToken | null> => null;
export const unsubscribe = async (
  _addresses: string[],
  _hashes: string[],
  _txids: string[],
): Promise<void> => {};
export const clearStoredNotifications = async (): Promise<void> => {};
export const getDeliveredNotifications = async (): Promise<TPayload[]> => [];
export const removeDeliveredNotifications = (_identifiers: string[] = []): void => {};
export const setApplicationIconBadgeNumber = (_badges: number): void => {};
export const removeAllDeliveredNotifications = (): void => {};
export const getDefaultUri = (): string => '';
export const saveUri = async (_uri: string): Promise<void> => {};
export const getSavedUri = async (): Promise<string> => '';
export const isNotificationsEnabled = async (): Promise<boolean> => false;
export const getStoredNotifications = async (): Promise<TPayload[]> => [];
export const initializeNotifications = async (_onProcessNotifications?: () => void): Promise<void> => {};
