import React, { useCallback } from 'react';
import { View, StyleSheet, NativeSyntheticEvent } from 'react-native';
import NativeSegmentedControl from '../codegen/SegmentedControlNativeComponent';

interface SegmentedControlProps {
  values: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  testID?: string;
  /** When true the whole control is greyed out and non-interactive. */
  disabled?: boolean;
}

interface SegmentedControlEvent {
  selectedIndex: number;
}

const SegmentedControl: React.FC<SegmentedControlProps> = ({ values, selectedIndex, onChange, testID, disabled = false }) => {
  const handleChange = useCallback(
    (event: NativeSyntheticEvent<SegmentedControlEvent>) => {
      if (disabled) return;
      if (event?.nativeEvent?.selectedIndex !== undefined) {
        onChange(event.nativeEvent.selectedIndex);
      }
    },
    [onChange, disabled],
  );

  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, disabled && styles.disabled]}>
      <NativeSegmentedControl
        values={values}
        selectedIndex={selectedIndex}
        enabled={!disabled}
        backgroundColor="transparent"
        momentary={false}
        style={styles.segmentedControl}
        onChange={handleChange}
        testID={testID}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginHorizontal: 0,
    marginBottom: 18,
    minHeight: 40,
  },
  segmentedControl: {
    height: 40,
  },
  disabled: {
    opacity: 0.4,
  },
});

export default SegmentedControl;
