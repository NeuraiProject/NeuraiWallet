import { useEffect, useRef, useState } from 'react';
import { Keyboard, LayoutAnimation } from 'react-native';

/** Keeps the embedded, non-inverted chat list above the edge-to-edge Android keyboard. */
const useDepinChatKeyboard = () => {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const messagesListRef = useRef<any>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
      setTimeout(() => messagesListRef.current?.scrollToEnd?.({ animated: true }), 300);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return { keyboardHeight, messagesListRef };
};

export default useDepinChatKeyboard;
