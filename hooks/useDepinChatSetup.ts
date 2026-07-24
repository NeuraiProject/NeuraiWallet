import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import {
  getDepinRpcBackend,
  getDepinRpcConfig,
  loadDepinRpcOverrides,
  type NeuraiBackend,
  type NeuraiNetwork,
} from '../blue_modules/neurai';
import type { DepinChatIdentity } from '../blue_modules/neurai/depinChatIdentity';
import type { DepinServerInfo } from '../components/depinChat/types';
import { ONE_COIN, PUBKEY_POLL_MS } from '../components/depinChat/constants';
import { normalizeAmount, parseRevealed } from '../components/depinChat/utils';

export type DepinRpc = <T = unknown>(method: string, params: unknown[]) => Promise<T>;

interface UseDepinChatSetupParams {
  identity: DepinChatIdentity | null;
  network: NeuraiNetwork;
  supported: boolean;
}

/** Provides the RPC-backed state needed before a token conversation is opened. */
const useDepinChatSetup = ({ identity, network, supported }: UseDepinChatSetupParams) => {
  const backendRef = useRef<{ key: string; backend: NeuraiBackend } | null>(null);
  const rpc = useMemo<DepinRpc | null>(() => {
    if (!supported) return null;
    return async <T = unknown>(method: string, params: unknown[]): Promise<T> => {
      await loadDepinRpcOverrides();
      const config = getDepinRpcConfig(network);
      const key = `${config.url}|${config.username ?? ''}|${config.password ?? ''}`;
      if (!backendRef.current || backendRef.current.key !== key) {
        backendRef.current = { key, backend: getDepinRpcBackend(network) };
      }
      return backendRef.current.backend.rpc<T>(method, params);
    };
  }, [network, supported]);

  const getBackend = useCallback(() => backendRef.current?.backend ?? getDepinRpcBackend(network), [network]);
  const [chatAssets, setChatAssets] = useState<Record<string, number>>({});
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [serverInfo, setServerInfo] = useState<DepinServerInfo | null>(null);
  const [pubkeyRevealed, setPubkeyRevealed] = useState<boolean | null>(null);
  const [depinBalance, setDepinBalance] = useState<number | null>(null);

  const refreshServerInfo = useCallback(() => {
    return rpc?.<DepinServerInfo>('depingetmsginfo', [])
      .then(info => setServerInfo(info))
      .catch(error => console.debug('DePINChat: depingetmsginfo failed', error));
  }, [rpc]);

  const loadAssets = useCallback(async () => {
    if (!rpc || !identity) return;
    setLoadingAssets(true);
    refreshServerInfo();
    try {
      const balances = (await rpc('listassetbalancesbyaddress', [identity.address])) as Record<string, unknown> | null;
      const assets: Record<string, number> = {};
      if (balances && typeof balances === 'object') {
        for (const name of Object.keys(balances)) {
          if (!name.startsWith('&')) continue;
          const amount = normalizeAmount(balances[name]);
          if (amount > 0) assets[name] = amount;
        }
      }
      setChatAssets(assets);
    } catch (error) {
      console.debug('DePINChat: listassetbalancesbyaddress failed', error);
    } finally {
      setLoadingAssets(false);
    }
  }, [identity, refreshServerInfo, rpc]);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        loadAssets();
      });
      return () => task.cancel();
    }, [loadAssets]),
  );

  useEffect(() => {
    if (!rpc || !identity || pubkeyRevealed === true) return;
    let cancelled = false;
    const checkOnce = async () => {
      try {
        const response = await rpc('getpubkey', [identity.address]);
        if (!cancelled) setPubkeyRevealed(parseRevealed(response));
      } catch {
        if (!cancelled) setPubkeyRevealed(null);
      }
    };
    checkOnce();
    const interval = setInterval(checkOnce, PUBKEY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [identity, pubkeyRevealed, rpc]);

  useEffect(() => {
    if (!identity || pubkeyRevealed !== false || !rpc) return;
    let cancelled = false;
    (async () => {
      try {
        const utxos = await getBackend().getUtxos([identity.address]);
        const satoshis = (utxos ?? [])
          .filter(utxo => !utxo.assetName || utxo.assetName === 'XNA')
          .reduce((sum, utxo) => sum + (Number(utxo.satoshis) || 0), 0);
        if (!cancelled) setDepinBalance(satoshis / ONE_COIN);
      } catch (error) {
        console.debug('DePINChat: failed to load chat address balance', error);
        if (!cancelled) setDepinBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getBackend, identity, pubkeyRevealed, rpc]);

  return { chatAssets, depinBalance, getBackend, loadingAssets, pubkeyRevealed, refreshServerInfo, rpc, serverInfo };
};

export default useDepinChatSetup;
