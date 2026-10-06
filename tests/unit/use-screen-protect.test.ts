import { act, cleanup, renderHook } from '@testing-library/react-native';
import { CaptureProtection } from 'react-native-capture-protection';
import { useScreenProtect } from '../../hooks/useScreenProtect';

jest.mock('../../blue_modules/environment', () => ({ isDesktop: false }));

const settle = (ms = 50) => act(() => jest.advanceTimersByTimeAsync(ms));

describe('useScreenProtect', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (CaptureProtection.prevent as jest.Mock).mockClear();
    (CaptureProtection.allow as jest.Mock).mockClear();
  });
  // The holder count lives at module level: unmount everything and let the release run, so each
  // test starts from zero holders and no pending release.
  afterEach(async () => {
    cleanup();
    await jest.advanceTimersByTimeAsync(5000);
    jest.useRealTimers();
  });

  it('reports ready only after protection is on', async () => {
    const { result } = renderHook(() => useScreenProtect());
    expect(result.current.isProtectionReady).toBe(false);

    act(() => {
      result.current.enableScreenProtect();
    });
    await settle();

    expect(CaptureProtection.prevent).toHaveBeenCalledTimes(1);
    expect(result.current.isProtectionReady).toBe(true);
  });

  it('keeps protection on through the closing frames, then lifts it', async () => {
    const { result } = renderHook(() => useScreenProtect());
    act(() => {
      result.current.enableScreenProtect();
    });
    await settle();

    act(() => {
      result.current.disableScreenProtect();
    });
    expect(result.current.isProtectionReady).toBe(false);
    await settle(500);
    expect(CaptureProtection.allow).not.toHaveBeenCalled();
    await settle(600);
    expect(CaptureProtection.allow).toHaveBeenCalledTimes(1);
  });

  it('does not lift protection while another screen still holds it', async () => {
    const a = renderHook(() => useScreenProtect());
    const b = renderHook(() => useScreenProtect());
    act(() => {
      a.result.current.enableScreenProtect();
      b.result.current.enableScreenProtect();
    });
    await settle();

    act(() => {
      a.result.current.disableScreenProtect();
    });
    await settle(2000);
    expect(CaptureProtection.allow).not.toHaveBeenCalled();

    b.unmount();
    await settle(2000);
    expect(CaptureProtection.allow).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending release when a new screen takes protection', async () => {
    const a = renderHook(() => useScreenProtect());
    act(() => {
      a.result.current.enableScreenProtect();
    });
    await settle();
    a.unmount();
    await settle(500);

    const b = renderHook(() => useScreenProtect());
    act(() => {
      b.result.current.enableScreenProtect();
    });
    await settle(2000);
    expect(CaptureProtection.allow).not.toHaveBeenCalled();
    b.unmount();
  });

  it('ignores a disable from a screen that never enabled', async () => {
    const a = renderHook(() => useScreenProtect());
    const b = renderHook(() => useScreenProtect());
    act(() => {
      a.result.current.enableScreenProtect();
    });
    await settle();

    act(() => {
      b.result.current.disableScreenProtect();
    });
    await settle(2000);
    expect(CaptureProtection.allow).not.toHaveBeenCalled();
    a.unmount();
  });
});
