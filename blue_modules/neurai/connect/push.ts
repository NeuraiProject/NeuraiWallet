/**
 * Push notifications for Neurai Connect.
 *
 * A session can outlive the moment the user scanned the QR code: a site may ask
 * for a signature hours later, with the wallet closed. The relay can wake it,
 * but it must not learn anything by doing so — it stores only
 * `topic -> did:key -> device token` and sends a notification with no content,
 * no domain and no topic (spec/relay-rpc.md section 7). Which request it was is
 * discovered by the wallet itself when it opens and fetches.
 *
 * Registrations live in the relay's memory, so they are renewed after every
 * reconnection and whenever a session is created or revoked. When the user has
 * not granted notification permission, or the relay has no push service
 * configured, everything here quietly does nothing: the flow still works, the
 * user just sees the request when they next open the wallet.
 */

import { Platform } from 'react-native';
import { getPushToken } from '../../notifications';
import { connectClient, onConnectSessionsChanged } from './client';

export interface ConnectPushToken {
  type: 'fcm' | 'apns';
  value: string;
}

/** The device token in the shape the relay's push service expects, or undefined. */
export async function connectPushToken(): Promise<ConnectPushToken | undefined> {
  try {
    const stored = await getPushToken();
    if (!stored || typeof stored.token !== 'string' || stored.token.length === 0) return undefined;
    const os = stored.os ?? (Platform.OS as 'ios' | 'android');
    return { type: os === 'ios' ? 'apns' : 'fcm', value: stored.token };
  } catch {
    // Notifications not granted or not available on this build.
    return undefined;
  }
}

/**
 * Registers the device for the topics of the live sessions. Safe to call often:
 * it is a no-op without a token, without a running client, or against a relay
 * with no push service.
 */
export async function registerConnectPush(): Promise<number> {
  const client = connectClient();
  if (!client) return 0;
  const token = await connectPushToken();
  if (!token) return 0;
  try {
    return await client.registerPush(token);
  } catch (e) {
    console.warn('[neurai-connect] push registration failed', e);
    return 0;
  }
}

/** Removes the device's registrations, for one topic or for all of them. */
export async function unregisterConnectPush(topics?: string[]): Promise<number> {
  const client = connectClient();
  if (!client) return 0;
  try {
    return await client.unregisterPush(topics);
  } catch (e) {
    console.warn('[neurai-connect] push unregistration failed', e);
    return 0;
  }
}

/**
 * Keeps the push registrations in step with the sessions: after a session is
 * settled or revoked, and whenever the app returns to the foreground (the relay
 * keeps registrations in memory, so a relay restart drops them).
 *
 * Call once at start-up; the returned function stops it.
 */
export function installConnectPush(): () => void {
  void registerConnectPush();
  return onConnectSessionsChanged(change => {
    // A revoked session must stop waking the phone, and the relay only lets the
    // did:key that registered a topic remove it — which is us.
    if (change.reason === 'deleted' && change.topic) void unregisterConnectPush([change.topic]);
    else void registerConnectPush();
  });
}
