import React from 'react';
import { ColorValue, DimensionValue, Image, ImageSourcePropType, StyleSheet, Text, Pressable, View } from 'react-native';
import { useLocale } from '@react-navigation/native';

import loc from '../loc';
import { Theme, useTheme } from './themes';

interface ButtonDetails {
  image: ImageSourcePropType;
  title: string;
  explain: string;
  borderColorActive: keyof Theme['colors'];
}

interface WalletButtonProps {
  buttonType: keyof typeof buttonDetails;
  testID?: string;
  onPress: () => void;
  size: {
    width: DimensionValue | undefined;
    height: DimensionValue | undefined;
  };
  active: boolean;
}

const buttonDetails: Record<string, ButtonDetails> = {
  NeuraiLegacy: {
    image: require('../img/addWallet/neurai.png'),
    title: loc.wallets.add_neurai_legacy,
    explain: loc.wallets.add_neurai_legacy_explain,
    borderColorActive: 'newBlue',
  },
  NeuraiPQ: {
    image: require('../img/addWallet/neurai.png'),
    title: loc.wallets.add_neurai_pq,
    explain: loc.wallets.add_neurai_pq_explain,
    borderColorActive: 'foregroundColor',
  },
};

const WalletButton: React.FC<WalletButtonProps> = ({ buttonType, testID, onPress, size, active }) => {
  const details = buttonDetails[buttonType];
  const { colors } = useTheme();
  const { direction } = useLocale();
  const borderColor = active ? colors[details.borderColorActive] : colors.buttonDisabledBackgroundColor;
  const stylesHook = StyleSheet.create({
    buttonContainer: {
      borderColor: borderColor as ColorValue,
      backgroundColor: colors.buttonDisabledBackgroundColor,
      minWidth: size.width,
      minHeight: size.height,
      height: size.height,
    },
    textTitle: {
      color: colors[details.borderColorActive] as ColorValue,
      fontWeight: 'bold',
      fontSize: 18,
      writingDirection: direction,
    },
    textExplain: {
      color: colors.alternativeTextColor,
      fontSize: 13,
      fontWeight: '500',
      writingDirection: direction,
    },
  });

  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed, styles.touchable]}
    >
      <View style={[styles.container, stylesHook.buttonContainer]}>
        <View style={styles.content}>
          <Image style={styles.image} source={details.image} />
          <View style={styles.textContainer}>
            <Text style={stylesHook.textTitle}>{details.title}</Text>
            <Text style={stylesHook.textExplain}>{details.explain}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  touchable: {
    flex: 1,
    marginBottom: 8,
  },
  container: {
    borderWidth: 1.5,
    borderRadius: 8,
  },
  content: {
    marginHorizontal: 16,
    marginVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  image: {
    width: 34,
    height: 34,
    marginRight: 8,
  },
  textContainer: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default WalletButton;
