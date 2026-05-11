import React from 'react';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import loc from '../../loc';
import { SettingsScrollView, SettingsSection, SettingsListItem } from '../../components/platform';

const SettingsTools: React.FC = () => {
  const navigation = useExtendedNavigation();

  return (
    <SettingsScrollView>
      <SettingsSection horizontalInset={false}>
        <SettingsListItem
          title={loc.is_it_my_address.title}
          iconName="search"
          onPress={() => navigation.navigate('IsItMyAddress')}
          testID="IsItMyAddress"
          chevron
          position="first"
        />
        <SettingsListItem
          title={loc.settings.network_broadcast}
          iconName="paperPlane"
          onPress={() => navigation.navigate('Broadcast')}
          testID="Broadcast"
          chevron
          position="middle"
        />
        <SettingsListItem
          title={loc.autofill_word.title}
          iconName="key"
          onPress={() => navigation.navigate('GenerateWord')}
          testID="GenerateWord"
          chevron
          position="last"
        />
      </SettingsSection>
    </SettingsScrollView>
  );
};

export default SettingsTools;
