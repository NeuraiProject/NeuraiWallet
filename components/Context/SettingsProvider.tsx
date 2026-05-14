import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import DefaultPreference from 'react-native-default-preference';
import { isReadClipboardAllowed, setReadClipboardAllowed } from '../../blue_modules/clipboard';
import { getPreferredCurrency, GROUP_IO_BLUEWALLET, initCurrencyDaemon, setPreferredCurrency } from '../../blue_modules/currency';
import { clearUseURv1, isURv1Enabled, setUseURv1 } from '../../blue_modules/ur';
import { BlueApp } from '../../class/blue-app';
import { saveLanguage, STORAGE_KEY } from '../../loc';
import { FiatUnit, TFiatUnit } from '../../models/fiatUnit';
import {
  getEnabled as getIsDeviceQuickActionsEnabled,
  setEnabled as setIsDeviceQuickActionsEnabled,
} from '../../hooks/useDeviceQuickActions';
import { getIsHandOffUseEnabled, setIsHandOffUseEnabled } from '../HandOffComponent';
import { useStorage } from '../../hooks/context/useStorage';
import { XnaUnit } from '../../models/xnaUnits';
import { TotalWalletsBalanceKey, TotalWalletsBalancePreferredUnit } from '../TotalWalletsBalance';
import { BLOCK_EXPLORERS, getBlockExplorerUrl, saveBlockExplorer, BlockExplorer, normalizeUrl } from '../../models/blockExplorer';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { isBalanceDisplayAllowed, setBalanceDisplayAllowed } from '../../hooks/useWidgetCommunication';
import AsyncStorage from '@react-native-async-storage/async-storage';

const getDoNotTrackStorage = async (): Promise<boolean> => {
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    const doNotTrack = await DefaultPreference.get(BlueApp.DO_NOT_TRACK);
    return doNotTrack === '1';
  } catch {
    console.error('Error getting DoNotTrack');
    return false;
  }
};

export const setTotalBalanceViewEnabledStorage = async (value: boolean): Promise<void> => {
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.set(TotalWalletsBalanceKey, value ? 'true' : 'false');
    console.debug('setTotalBalanceViewEnabledStorage value:', value);
  } catch (e) {
    console.error('Error setting TotalBalanceViewEnabled:', e);
  }
};

export const getIsTotalBalanceViewEnabled = async (): Promise<boolean> => {
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    const isEnabledValue = (await DefaultPreference.get(TotalWalletsBalanceKey)) ?? 'true';
    console.debug('getIsTotalBalanceViewEnabled', isEnabledValue);
    return isEnabledValue === 'true';
  } catch (e) {
    console.error('Error getting TotalBalanceViewEnabled:', e);
    return true;
  }
};

export const setTotalBalancePreferredUnitStorageFunc = async (unit: XnaUnit): Promise<void> => {
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.set(TotalWalletsBalancePreferredUnit, unit);
  } catch (e) {
    console.error('Error setting TotalBalancePreferredUnit:', e);
  }
};

export const getTotalBalancePreferredUnit = async (): Promise<XnaUnit> => {
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    const unit = (await DefaultPreference.get(TotalWalletsBalancePreferredUnit)) as XnaUnit | null;
    return unit ?? XnaUnit.XNA;
  } catch (e) {
    console.error('Error getting TotalBalancePreferredUnit:', e);
    return XnaUnit.XNA;
  }
};

const PQ_ADDRESS_REUSE_KEY = 'PQ_ADDRESS_REUSE';

export const getIsPQAddressReuseEnabled = async (): Promise<boolean> => {
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    const value = await DefaultPreference.get(PQ_ADDRESS_REUSE_KEY);
    return value !== 'false';
  } catch (e) {
    console.error('Error getting PQAddressReuse:', e);
    return true;
  }
};

export const setIsPQAddressReuseEnabledStorageFunc = async (value: boolean): Promise<void> => {
  try {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.set(PQ_ADDRESS_REUSE_KEY, value ? 'true' : 'false');
  } catch (e) {
    console.error('Error setting PQAddressReuse:', e);
  }
};

interface SettingsContextType {
  preferredFiatCurrency: TFiatUnit;
  setPreferredFiatCurrencyStorage: (currency: TFiatUnit) => Promise<void>;
  language: string;
  setLanguageStorage: (language: string) => Promise<void>;
  isHandOffUseEnabled: boolean;
  setIsHandOffUseEnabledAsyncStorage: (value: boolean) => Promise<void>;
  isPrivacyBlurEnabled: boolean;
  setIsPrivacyBlurEnabled: (value: boolean) => void;
  isDoNotTrackEnabled: boolean;
  setDoNotTrackStorage: (value: boolean) => Promise<void>;
  isWidgetBalanceDisplayAllowed: boolean;
  setIsWidgetBalanceDisplayAllowedStorage: (value: boolean) => Promise<void>;
  isLegacyURv1Enabled: boolean;
  setIsLegacyURv1EnabledStorage: (value: boolean) => Promise<void>;
  isClipboardGetContentEnabled: boolean;
  setIsClipboardGetContentEnabledStorage: (value: boolean) => Promise<void>;
  isQuickActionsEnabled: boolean;
  setIsQuickActionsEnabledStorage: (value: boolean) => Promise<void>;
  isTotalBalanceEnabled: boolean;
  setIsTotalBalanceEnabledStorage: (value: boolean) => Promise<void>;
  totalBalancePreferredUnit: XnaUnit;
  setTotalBalancePreferredUnitStorage: (unit: XnaUnit) => Promise<void>;
  selectedBlockExplorer: BlockExplorer;
  setBlockExplorerStorage: (explorer: BlockExplorer) => Promise<boolean>;
  isElectrumDisabled: boolean;
  setIsElectrumDisabled: (value: boolean) => void;
  isPQAddressReuseEnabled: boolean;
  setIsPQAddressReuseEnabledStorage: (value: boolean) => Promise<void>;
}

const defaultSettingsContext: SettingsContextType = {
  preferredFiatCurrency: FiatUnit.USD,
  setPreferredFiatCurrencyStorage: async () => {},
  language: 'en',
  setLanguageStorage: async () => {},
  isHandOffUseEnabled: false,
  setIsHandOffUseEnabledAsyncStorage: async () => {},
  isPrivacyBlurEnabled: true,
  setIsPrivacyBlurEnabled: () => {},
  isDoNotTrackEnabled: false,
  setDoNotTrackStorage: async () => {},
  isWidgetBalanceDisplayAllowed: true,
  setIsWidgetBalanceDisplayAllowedStorage: async () => {},
  isLegacyURv1Enabled: false,
  setIsLegacyURv1EnabledStorage: async () => {},
  isClipboardGetContentEnabled: true,
  setIsClipboardGetContentEnabledStorage: async () => {},
  isQuickActionsEnabled: true,
  setIsQuickActionsEnabledStorage: async () => {},
  isTotalBalanceEnabled: true,
  setIsTotalBalanceEnabledStorage: async () => {},
  totalBalancePreferredUnit: XnaUnit.XNA,
  setTotalBalancePreferredUnitStorage: async () => {},
  selectedBlockExplorer: BLOCK_EXPLORERS.default,
  setBlockExplorerStorage: async () => false,
  isElectrumDisabled: false,
  setIsElectrumDisabled: () => {},
  isPQAddressReuseEnabled: true,
  setIsPQAddressReuseEnabledStorage: async () => {},
};

export const SettingsContext = createContext<SettingsContextType>(defaultSettingsContext);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = React.memo(({ children }: { children: React.ReactNode }) => {
  const [preferredFiatCurrency, setPreferredFiatCurrencyState] = useState<TFiatUnit>(FiatUnit.USD);
  const [language, setLanguage] = useState<string>('en');
  const [isHandOffUseEnabled, setIsHandOffUseEnabledState] = useState<boolean>(false);
  const [isPrivacyBlurEnabled, setIsPrivacyBlurEnabled] = useState<boolean>(true);
  const [isDoNotTrackEnabled, setIsDoNotTrackEnabled] = useState<boolean>(false);
  const [isWidgetBalanceDisplayAllowed, setIsWidgetBalanceDisplayAllowed] = useState<boolean>(true);
  const [isLegacyURv1Enabled, setIsLegacyURv1Enabled] = useState<boolean>(false);
  const [isClipboardGetContentEnabled, setIsClipboardGetContentEnabled] = useState<boolean>(true);
  const [isQuickActionsEnabled, setIsQuickActionsEnabled] = useState<boolean>(true);
  const [isTotalBalanceEnabled, setIsTotalBalanceEnabled] = useState<boolean>(true);
  const [totalBalancePreferredUnit, setTotalBalancePreferredUnit] = useState<XnaUnit>(XnaUnit.XNA);
  const [selectedBlockExplorer, setSelectedBlockExplorer] = useState<BlockExplorer>(BLOCK_EXPLORERS.default);
  const [isElectrumDisabled, setIsElectrumDisabled] = useState<boolean>(true);
  const [isPQAddressReuseEnabled, setIsPQAddressReuseEnabled] = useState<boolean>(true);

  const { walletsInitialized } = useStorage();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
      } catch (e) {
        console.error('Error setting preference name:', e);
      }

      // BlueElectrum is dead code for NeuraiWallet (we use the RPC backend in
      // blue_modules/neurai). Force the flag on so consumers like
      // `WalletTransactions` don't pause auto-refresh and we never reach the
      // `connectMain()` path below.
      setIsElectrumDisabled(true);
      const promises: Promise<void>[] = [
        getIsHandOffUseEnabled().then(handOff => {
          setIsHandOffUseEnabledState(handOff);
        }),
        AsyncStorage.getItem(STORAGE_KEY).then(lang => {
          setLanguage(lang ?? 'en');
        }),
        isBalanceDisplayAllowed().then(balanceDisplayAllowed => {
          setIsWidgetBalanceDisplayAllowed(balanceDisplayAllowed);
        }),
        isURv1Enabled().then(urv1Enabled => {
          setIsLegacyURv1Enabled(urv1Enabled);
        }),
        isReadClipboardAllowed().then(clipboardEnabled => {
          setIsClipboardGetContentEnabled(clipboardEnabled);
        }),
        getIsDeviceQuickActionsEnabled().then(quickActionsEnabled => {
          setIsQuickActionsEnabled(quickActionsEnabled);
        }),
        getDoNotTrackStorage().then(doNotTrack => {
          setIsDoNotTrackEnabled(doNotTrack);
        }),
        getIsTotalBalanceViewEnabled().then(totalBalanceEnabled => {
          setIsTotalBalanceEnabled(totalBalanceEnabled);
        }),
        getTotalBalancePreferredUnit().then(preferredUnit => {
          setTotalBalancePreferredUnit(preferredUnit);
        }),
        getBlockExplorerUrl().then(url => {
          const predefinedExplorer = Object.values(BLOCK_EXPLORERS).find(explorer => normalizeUrl(explorer.url) === normalizeUrl(url));
          setSelectedBlockExplorer(predefinedExplorer ?? ({ key: 'custom', name: 'Custom', url } as BlockExplorer));
        }),
        getIsPQAddressReuseEnabled().then(enabled => {
          setIsPQAddressReuseEnabled(enabled);
        }),
      ];

      const results = await Promise.allSettled(promises);

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Error loading setting ${index}:`, result.reason);
        }
      });
    };

    loadSettings();
  }, []);

  useEffect(() => {
    initCurrencyDaemon()
      .then(getPreferredCurrency)
      .then(currency => {
        console.debug('SettingsContext currency:', currency);
        setPreferredFiatCurrencyState(currency as TFiatUnit);
      })
      .catch(e => {
        console.error('Error initializing currency daemon or getting preferred currency:', e);
      });
  }, []);

  useEffect(() => {
    // Make sure we never accidentally open a Bitcoin Electrum socket — the
    // hosts in BlueElectrum.ts (electrum1.bluewallet.io etc.) can't serve
    // Neurai data and produce noisy reconnect loops.
    if (walletsInitialized) {
      BlueElectrum.forceDisconnect();
    }
  }, [walletsInitialized]);

  const setPreferredFiatCurrencyStorage = useCallback(async (currency: TFiatUnit): Promise<void> => {
    try {
      await setPreferredCurrency(currency);
      setPreferredFiatCurrencyState(currency);
    } catch (e) {
      console.error('Error setting preferredFiatCurrency:', e);
    }
  }, []);

  const setLanguageStorage = useCallback(async (newLanguage: string): Promise<void> => {
    try {
      await saveLanguage(newLanguage);
      setLanguage(newLanguage);
    } catch (e) {
      console.error('Error setting language:', e);
    }
  }, []);

  const setDoNotTrackStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
      if (value) {
        await DefaultPreference.set(BlueApp.DO_NOT_TRACK, '1');
      } else {
        await DefaultPreference.clear(BlueApp.DO_NOT_TRACK);
      }
      setIsDoNotTrackEnabled(value);
    } catch (e) {
      console.error('Error setting DoNotTrack:', e);
    }
  }, []);

  const setIsHandOffUseEnabledAsyncStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      console.debug('setIsHandOffUseEnabledAsyncStorage', value);
      await setIsHandOffUseEnabled(value);
      setIsHandOffUseEnabledState(value);
    } catch (e) {
      console.error('Error setting isHandOffUseEnabled:', e);
    }
  }, []);

  const setIsWidgetBalanceDisplayAllowedStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      await setBalanceDisplayAllowed(value);
      setIsWidgetBalanceDisplayAllowed(value);
    } catch (e) {
      console.error('Error setting isWidgetBalanceDisplayAllowed:', e);
    }
  }, []);

  const setIsLegacyURv1EnabledStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      if (value) {
        await setUseURv1();
      } else {
        await clearUseURv1();
      }
      setIsLegacyURv1Enabled(value);
    } catch (e) {
      console.error('Error setting isLegacyURv1Enabled:', e);
    }
  }, []);

  const setIsClipboardGetContentEnabledStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      await setReadClipboardAllowed(value);
      setIsClipboardGetContentEnabled(value);
    } catch (e) {
      console.error('Error setting isClipboardGetContentEnabled:', e);
    }
  }, []);

  const setIsQuickActionsEnabledStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      await setIsDeviceQuickActionsEnabled(value);
      setIsQuickActionsEnabled(value);
    } catch (e) {
      console.error('Error setting isQuickActionsEnabled:', e);
    }
  }, []);
  const setIsTotalBalanceEnabledStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      await setTotalBalanceViewEnabledStorage(value);
      setIsTotalBalanceEnabled(value);
    } catch (e) {
      console.error('Error setting isTotalBalanceEnabled:', e);
    }
  }, []);

  const setTotalBalancePreferredUnitStorage = useCallback(async (unit: XnaUnit): Promise<void> => {
    try {
      await setTotalBalancePreferredUnitStorageFunc(unit);
      setTotalBalancePreferredUnit(unit);
    } catch (e) {
      console.error('Error setting totalBalancePreferredUnit:', e);
    }
  }, []);

  const setIsPQAddressReuseEnabledStorage = useCallback(async (value: boolean): Promise<void> => {
    try {
      await setIsPQAddressReuseEnabledStorageFunc(value);
      setIsPQAddressReuseEnabled(value);
    } catch (e) {
      console.error('Error setting isPQAddressReuseEnabled:', e);
    }
  }, []);

  const setBlockExplorerStorage = useCallback(async (explorer: BlockExplorer): Promise<boolean> => {
    try {
      const success = await saveBlockExplorer(explorer.url);
      if (success) {
        setSelectedBlockExplorer(explorer);
      }
      return success;
    } catch (e) {
      console.error('Error setting BlockExplorer:', e);
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({
      preferredFiatCurrency,
      setPreferredFiatCurrencyStorage,
      language,
      setLanguageStorage,
      isHandOffUseEnabled,
      setIsHandOffUseEnabledAsyncStorage,
      isPrivacyBlurEnabled,
      setIsPrivacyBlurEnabled,
      isDoNotTrackEnabled,
      setDoNotTrackStorage,
      isWidgetBalanceDisplayAllowed,
      setIsWidgetBalanceDisplayAllowedStorage,
      isLegacyURv1Enabled,
      setIsLegacyURv1EnabledStorage,
      isClipboardGetContentEnabled,
      setIsClipboardGetContentEnabledStorage,
      isQuickActionsEnabled,
      setIsQuickActionsEnabledStorage,
      isTotalBalanceEnabled,
      setIsTotalBalanceEnabledStorage,
      totalBalancePreferredUnit,
      setTotalBalancePreferredUnitStorage,
      selectedBlockExplorer,
      setBlockExplorerStorage,
      isElectrumDisabled,
      setIsElectrumDisabled,
      isPQAddressReuseEnabled,
      setIsPQAddressReuseEnabledStorage,
    }),
    [
      preferredFiatCurrency,
      setPreferredFiatCurrencyStorage,
      language,
      setLanguageStorage,
      isHandOffUseEnabled,
      setIsHandOffUseEnabledAsyncStorage,
      isPrivacyBlurEnabled,
      setIsPrivacyBlurEnabled,
      isDoNotTrackEnabled,
      setDoNotTrackStorage,
      isWidgetBalanceDisplayAllowed,
      setIsWidgetBalanceDisplayAllowedStorage,
      isLegacyURv1Enabled,
      setIsLegacyURv1EnabledStorage,
      isClipboardGetContentEnabled,
      setIsClipboardGetContentEnabledStorage,
      isQuickActionsEnabled,
      setIsQuickActionsEnabledStorage,
      isTotalBalanceEnabled,
      setIsTotalBalanceEnabledStorage,
      totalBalancePreferredUnit,
      setTotalBalancePreferredUnitStorage,
      selectedBlockExplorer,
      setBlockExplorerStorage,
      isElectrumDisabled,
      isPQAddressReuseEnabled,
      setIsPQAddressReuseEnabledStorage,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
});
