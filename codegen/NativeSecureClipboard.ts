import { TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  setSensitiveString(text: string): Promise<boolean>;
}

const nativeModule = TurboModuleRegistry.get<Spec>('SecureClipboard');

export default nativeModule;
