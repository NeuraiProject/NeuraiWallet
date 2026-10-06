import { Platform, TextInputProps } from 'react-native';

/**
 * Props for a TextInput that receives recovery words. On Android the visible-password variation is
 * what keeps keyboards (Gboard and others) from learning the words and suggesting them later, and
 * turning autofill off keeps the system from offering to save them in a password manager.
 */
export const secretTextInputProps = {
  autoCapitalize: 'none',
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'off',
  importantForAutofill: 'no',
  textContentType: 'none',
  keyboardType: Platform.OS === 'android' ? 'visible-password' : 'default',
} as const satisfies TextInputProps;
