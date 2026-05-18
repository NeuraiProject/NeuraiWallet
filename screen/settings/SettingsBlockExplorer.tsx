import React, { useRef, useCallback, useState, useEffect } from 'react';
import { TextInput, LayoutAnimation } from 'react-native';
import loc from '../../loc';
import { SettingsScrollView, SettingsSection, SettingsListItem, SettingsSectionHeader } from '../../components/platform';
import {
  getBlockExplorersList,
  BlockExplorer,
  isValidUrl,
  normalizeUrl,
  BLOCK_EXPLORERS,
  removeBlockExplorer,
  removeTestnetBlockExplorer,
} from '../../models/blockExplorer';
import presentAlert from '../../components/Alert';
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../blue_modules/hapticFeedback';
import { useSettings } from '../../hooks/context/useSettings';
import SettingsBlockExplorerCustomUrlItem, { CustomBlockExplorerTarget } from '../../components/SettingsBlockExplorerCustomUrlListItem';

const inferInitialCustomTarget = (mainnet: BlockExplorer, testnet: BlockExplorer): CustomBlockExplorerTarget => {
  if (mainnet.key === 'custom') return 'mainnet';
  if (testnet.key === 'custom') return 'testnet';
  return 'mainnet';
};

const SettingsBlockExplorer: React.FC = () => {
  const { selectedBlockExplorer, setBlockExplorerStorage, selectedTestnetBlockExplorer, setTestnetBlockExplorerStorage } = useSettings();
  const customUrlInputRef = useRef<TextInput>(null);

  const [customTarget, setCustomTarget] = useState<CustomBlockExplorerTarget>(() =>
    inferInitialCustomTarget(selectedBlockExplorer, selectedTestnetBlockExplorer),
  );
  const [customUrl, setCustomUrl] = useState<string>(() =>
    selectedBlockExplorer.key === 'custom'
      ? selectedBlockExplorer.url
      : selectedTestnetBlockExplorer.key === 'custom'
        ? selectedTestnetBlockExplorer.url
        : '',
  );
  const [isCustomEnabled, setIsCustomEnabled] = useState<boolean>(
    () => selectedBlockExplorer.key === 'custom' || selectedTestnetBlockExplorer.key === 'custom',
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const predefinedExplorers = getBlockExplorersList().filter(explorer => explorer.key !== 'custom');
  const mainnetExplorers = predefinedExplorers.filter(e => e.key !== 'testnet');
  const testnetExplorers = predefinedExplorers.filter(e => e.key === 'testnet');

  const isMainnetCustomActive = isCustomEnabled && customTarget === 'mainnet';
  const isTestnetCustomActive = isCustomEnabled && customTarget === 'testnet';

  const handleMainnetExplorerPress = useCallback(
    async (explorer: BlockExplorer) => {
      const success = await setBlockExplorerStorage(explorer);
      if (success) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        if (customTarget === 'mainnet') setIsCustomEnabled(false);
      } else {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ message: loc.settings.block_explorer_error_saving_custom });
      }
    },
    [setBlockExplorerStorage, customTarget],
  );

  const handleTestnetExplorerPress = useCallback(
    async (explorer: BlockExplorer) => {
      const success = await setTestnetBlockExplorerStorage(explorer);
      if (success) {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        if (customTarget === 'testnet') setIsCustomEnabled(false);
      } else {
        triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
        presentAlert({ message: loc.settings.block_explorer_error_saving_custom });
      }
    },
    [setTestnetBlockExplorerStorage, customTarget],
  );

  const handleCustomUrlChange = useCallback((url: string) => {
    setCustomUrl(url);
  }, []);

  const handleSubmitCustomUrl = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const customUrlNormalized = normalizeUrl(customUrl);

    if (!isValidUrl(customUrlNormalized)) {
      presentAlert({ message: loc.settings.block_explorer_invalid_custom_url });
      customUrlInputRef.current?.focus();
      setIsSubmitting(false);
      return;
    }

    const customExplorer: BlockExplorer = { key: 'custom', name: 'Custom', url: customUrlNormalized };
    const setter = customTarget === 'mainnet' ? setBlockExplorerStorage : setTestnetBlockExplorerStorage;
    const success = await setter(customExplorer);

    if (success) {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
    } else {
      triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
      presentAlert({ message: loc.settings.block_explorer_error_saving_custom });
    }
    setIsSubmitting(false);
  }, [customUrl, customTarget, setBlockExplorerStorage, setTestnetBlockExplorerStorage, isSubmitting]);

  const restoreTargetDefault = useCallback(
    async (target: CustomBlockExplorerTarget) => {
      if (target === 'mainnet') {
        await removeBlockExplorer();
        return setBlockExplorerStorage(BLOCK_EXPLORERS.default);
      }
      await removeTestnetBlockExplorer();
      return setTestnetBlockExplorerStorage(BLOCK_EXPLORERS.testnet);
    },
    [setBlockExplorerStorage, setTestnetBlockExplorerStorage],
  );

  const handleCustomSwitchToggle = useCallback(
    async (value: boolean) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsCustomEnabled(value);
      if (value) {
        customUrlInputRef.current?.focus();
      } else {
        const success = await restoreTargetDefault(customTarget);
        if (success) {
          triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
        } else {
          triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
          if (!isSubmitting) {
            presentAlert({ message: loc.settings.block_explorer_error_saving_custom });
          }
        }
      }
    },
    [restoreTargetDefault, customTarget, isSubmitting],
  );

  const handleTargetChange = useCallback(
    async (next: CustomBlockExplorerTarget) => {
      if (next === customTarget) return;
      const previous = customTarget;
      setCustomTarget(next);
      // If the previous target had a custom URL active, restore its default so
      // we don't leave a stale custom preference on a network the user is no
      // longer pointing at.
      if (isCustomEnabled) await restoreTargetDefault(previous);
    },
    [customTarget, isCustomEnabled, restoreTargetDefault],
  );

  useEffect(() => {
    return () => {
      if (isCustomEnabled) {
        const customUrlNormalized = normalizeUrl(customUrl);
        if (!isValidUrl(customUrlNormalized)) {
          (async () => {
            const success = await restoreTargetDefault(customTarget);
            if (!success) {
              triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
              presentAlert({ message: loc.settings.block_explorer_error_saving_custom });
            }
          })();
        }
      }
    };
  }, [customUrl, isCustomEnabled, customTarget, restoreTargetDefault]);

  const renderExplorerRow = (
    explorer: BlockExplorer,
    index: number,
    total: number,
    selected: BlockExplorer,
    onPress: (e: BlockExplorer) => void,
    rowDisabled: boolean,
  ) => {
    const isSelected = !rowDisabled && normalizeUrl(selected.url || '') === normalizeUrl(explorer.url || '');
    const isFirst = index === 0;
    const isLast = index === total - 1;
    return (
      <SettingsListItem
        key={explorer.key}
        title={explorer.name}
        subtitle={explorer.url}
        onPress={() => onPress(explorer)}
        checkmark={isSelected}
        disabled={rowDisabled}
        position={isFirst && isLast ? 'single' : isFirst ? 'first' : isLast ? 'last' : 'middle'}
      />
    );
  };

  return (
    <SettingsScrollView>
      <SettingsSectionHeader title={loc.wallets.neurai_network_mainnet} />
      <SettingsSection horizontalInset={false}>
        {mainnetExplorers.map((explorer, index) =>
          renderExplorerRow(explorer, index, mainnetExplorers.length, selectedBlockExplorer, handleMainnetExplorerPress, isMainnetCustomActive),
        )}
      </SettingsSection>

      <SettingsSectionHeader title={loc.wallets.neurai_network_testnet} />
      <SettingsSection horizontalInset={false}>
        {testnetExplorers.map((explorer, index) =>
          renderExplorerRow(explorer, index, testnetExplorers.length, selectedTestnetBlockExplorer, handleTestnetExplorerPress, isTestnetCustomActive),
        )}
      </SettingsSection>

      <SettingsSectionHeader title={loc.wallets.details_advanced} />
      <SettingsSection compact horizontalInset={false}>
        <SettingsBlockExplorerCustomUrlItem
          isCustomEnabled={isCustomEnabled}
          onSwitchToggle={handleCustomSwitchToggle}
          customUrl={customUrl}
          onCustomUrlChange={handleCustomUrlChange}
          onSubmitCustomUrl={handleSubmitCustomUrl}
          inputRef={customUrlInputRef}
          target={customTarget}
          onTargetChange={handleTargetChange}
        />
      </SettingsSection>
    </SettingsScrollView>
  );
};

export default SettingsBlockExplorer;
