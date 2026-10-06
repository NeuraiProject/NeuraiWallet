import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import { Platform } from 'react-native';
import NativeSecureClipboard from '../codegen/NativeSecureClipboard';

const STORAGE_KEY: string = 'ClipboardReadAllowed';

export const isReadClipboardAllowed = async (): Promise<boolean> => {
  try {
    const clipboardAccessAllowed = await AsyncStorage.getItem(STORAGE_KEY);
    if (clipboardAccessAllowed === null) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(true));
      return true;
    }
    return !!JSON.parse(clipboardAccessAllowed);
  } catch {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(true));
    return true;
  }
};

export const setReadClipboardAllowed = async (value: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Boolean(value)));
  } catch (error) {
    console.error('Failed to set clipboard permission:', error);
    throw error;
  }
};

export const getClipboardContent = async (): Promise<string | undefined> => {
  try {
    const isAllowed = await isReadClipboardAllowed();
    if (!isAllowed) return undefined;

    const hasString = await Clipboard.hasString();
    return hasString ? await Clipboard.getString() : undefined;
  } catch (error) {
    console.error('Error accessing clipboard:', error);
    return undefined;
  }
};

/**
 * Copies a secret (e.g. a private key) flagged as sensitive on Android, so the system clipboard
 * preview hides it and keyboards keep it out of their clipboard history. Elsewhere it is a plain copy.
 */
export const setSensitiveClipboardString = async (text: string): Promise<void> => {
  if (Platform.OS === 'android' && NativeSecureClipboard) {
    try {
      await NativeSecureClipboard.setSensitiveString(text);
      return;
    } catch (error) {
      console.warn('setSensitiveClipboardString: falling back to a plain copy', error);
    }
  }
  Clipboard.setString(text);
};
