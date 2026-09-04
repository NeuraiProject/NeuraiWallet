/**
 * Keeps Neurai Connect alive for the whole app and brings approvals to the
 * front.
 *
 * The relay pushes whatever arrived while the wallet was asleep as soon as the
 * client resubscribes, so a request can turn up without the user having just
 * scanned anything — for example the second and later requests of a session
 * that was established days ago. Something has to notice those and open the
 * right screen; that is this hook, mounted once next to the other companion
 * listeners.
 *
 * Two rules keep it from stealing the screen:
 *
 * - It only navigates while the app is in the foreground. A navigation
 *   dispatched from the background would land the user on an approval screen
 *   they did not ask for the next time they unlock the phone.
 * - It never navigates to an approval that is already open, and it stands
 *   aside entirely while `ConnectPair` is on screen: the pairing screen is
 *   waiting for that very item and replaces itself with the right screen, so
 *   both acting would push two copies onto the stack.
 *
 * Notices are the SDK telling us it refused something on our behalf (an expired
 * login, a cross-domain `signMessage` in "block" mode). They are informational
 * and never block: the protocol answer has already been sent.
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { CommonActions } from '@react-navigation/native';

import presentAlert, { AlertType } from '../components/Alert';
import { onConnectIncoming, onConnectNotice, startConnect, type ConnectNotice } from '../blue_modules/neurai/connect/client';
import { installConnectPush } from '../blue_modules/neurai/connect/push';
import loc from '../loc';
import { navigationRef } from '../NavigationService';
import { screenForIncoming } from '../screen/connect/logic';

/** The sentence a notice is shown as. The SDK's own reason is appended verbatim. */
function noticeText(notice: ConnectNotice): string {
  switch (notice.kind) {
    case 'auth_rejected':
      return loc.formatString(loc.connect.notice_auth_rejected, { reason: notice.message });
    case 'request_blocked':
      return loc.formatString(loc.connect.notice_request_blocked, { reason: notice.message });
    default:
      return loc.formatString(loc.connect.notice_error, { reason: notice.message });
  }
}

const useNeuraiConnect = () => {
  useEffect(() => {
    startConnect().catch((error: unknown) => console.warn('[neurai-connect] could not start', error));

    const stopIncoming = onConnectIncoming(item => {
      if (AppState.currentState !== 'active') return;
      if (!navigationRef.isReady()) return;
      const current = navigationRef.getCurrentRoute();
      if (current?.name === 'ConnectPair') return;
      const screen = screenForIncoming(item.kind);
      const openId = (current?.params as { id?: unknown } | undefined)?.id;
      if (current?.name === screen && openId !== undefined && String(openId) === String(item.id)) return;
      navigationRef.dispatch(CommonActions.navigate({ name: screen, params: { id: item.id } }));
    });

    const stopNotice = onConnectNotice(notice => presentAlert({ message: noticeText(notice), type: AlertType.Toast }));

    // Keeps the relay's push registrations in step with the live sessions, so a request
    // that arrives with the wallet closed can still wake it. A no-op when the user has
    // not granted notifications or the relay has no push service.
    const stopPush = installConnectPush();

    return () => {
      stopIncoming();
      stopNotice();
      stopPush();
    };
  }, []);
};

export default useNeuraiConnect;
