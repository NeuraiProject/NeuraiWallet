import { CaptureProtection } from 'react-native-capture-protection';
import { isDesktop } from '../blue_modules/environment';
import { useCallback, useEffect, useRef, useState } from 'react';

// Capture protection (FLAG_SECURE on Android) belongs to the whole window, so every screen that
// asks for it shares one switch. Count the holders so a screen going away cannot lift the
// protection while another one still needs it, and keep it on for a moment after the last holder
// leaves: the closing animation keeps drawing the old screen for a few frames, and a screen share
// or recording would catch the secret in them (BlueWallet issue #8964).
const RELEASE_DELAY_MS = 1000;
let holders = 0;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

const acquire = async (): Promise<void> => {
  holders++;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
  }
  await CaptureProtection.prevent();
};

const release = (): void => {
  holders = Math.max(0, holders - 1);
  if (holders > 0) return;
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = undefined;
    if (holders === 0) CaptureProtection.allow().catch(() => {});
  }, RELEASE_DELAY_MS);
};

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export const useScreenProtect = () => {
  const isHolding = useRef(false);
  // True once the window is protected, so a screen can hold back secrets until then instead of
  // drawing them in the frames before FLAG_SECURE lands.
  const [isProtectionReady, setIsProtectionReady] = useState<boolean>(isDesktop);

  const enableScreenProtect = useCallback(async () => {
    if (isDesktop || isHolding.current) return;
    isHolding.current = true;
    try {
      await acquire();
      await nextFrame();
    } catch (error) {
      // Without an activity the flag cannot be set; showing the screen beats locking the user out
      // of their own backup.
      console.warn('useScreenProtect: could not enable capture protection', error);
    }
    if (isHolding.current) setIsProtectionReady(true);
  }, []);

  const disableScreenProtect = useCallback(async () => {
    if (isDesktop || !isHolding.current) return;
    isHolding.current = false;
    setIsProtectionReady(false);
    release();
  }, []);

  useEffect(
    () => () => {
      if (isHolding.current) {
        isHolding.current = false;
        release();
      }
    },
    [],
  );

  const isScreenBeingRecorded = useCallback(async () => {
    if (isDesktop) return false;
    return await CaptureProtection.isScreenRecording();
  }, []);

  return {
    enableScreenProtect,
    disableScreenProtect,
    isProtectionReady,
    isScreenBeingRecorded,
  };
};
