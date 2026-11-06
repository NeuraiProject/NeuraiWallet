import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, NativeScrollEvent, NativeSyntheticEvent, ScrollView, TextInput } from 'react-native';

/** Room left between the focused field and the top edge of the keyboard. */
const FIELD_MARGIN = 16;

/**
 * Keeps the focused field of a scrollable form in sight above the keyboard.
 *
 * Edge-to-edge Android draws the keyboard over the window instead of resizing
 * it, so a ScrollView keeps its full height and the field it scrolls to on
 * focus can sit behind the keys. While the keyboard is up, `bottomInset` is how
 * much of the ScrollView the keyboard covers (zero where the window already
 * shrank): applied as a bottom margin, the ScrollView ends at the keyboard's top
 * edge, and once it has shrunk (`onLayout`) the focused field is scrolled above it.
 *
 * Listens only while `active`: the keyboard listeners are app-wide, and a form
 * kept mounted behind another tab or under a modal must not react to theirs.
 */
export default function useScrollAboveKeyboard(active: boolean) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const insetRef = useRef(0);
  const [bottomInset, setBottomInset] = useState(0);

  const applyInset = useCallback((inset: number) => {
    insetRef.current = inset;
    setBottomInset(inset);
  }, []);

  useEffect(() => {
    if (!active) return;
    const show = Keyboard.addListener('keyboardDidShow', event => {
      const keyboardTop = event.endCoordinates.screenY;
      scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, y, _width, height) => {
        // Where the ScrollView ends without the inset currently applied.
        const bottom = y + height + insetRef.current;
        applyInset(Math.max(0, Math.round(bottom - keyboardTop)));
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => applyInset(0));
    return () => {
      show.remove();
      hide.remove();
      applyInset(0);
    };
  }, [active, applyInset]);

  const revealFocused = useCallback(() => {
    const scroll = scrollRef.current;
    const input = TextInput.State.currentlyFocusedInput();
    if (!scroll || !input) return;
    scroll.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
      input.measureInWindow((_ix, inputTop, _iw, inputHeight) => {
        // A field outside this ScrollView (above it) is not ours to reveal.
        if (inputTop < top) return;
        const overflow = inputTop + inputHeight + FIELD_MARGIN - (top + height);
        if (overflow > 0) scroll.scrollTo({ y: scrollY.current + overflow, animated: true });
      });
    });
  }, []);

  const onLayout = useCallback(() => {
    if (insetRef.current > 0) revealFocused();
  }, [revealFocused]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  return { scrollRef, bottomInset, onLayout, onScroll };
}
