import { useCallback, useState, useRef } from 'react';

import type { RecipientInfo } from './useDePINChat';
import type { DepinChatIdentity } from '../blue_modules/neurai/depinChatIdentity';
import { getVerifiedPool } from '../blue_modules/neurai/depinPool';
import { verifiedRecipients } from '../blue_modules/neurai/depinSend';
import { getDepinRpcConfig } from '../blue_modules/neurai/depinRpcOverrides';
import type { DepinRpc } from './useDepinChatSetup';

interface UseDepinChatAssetSelectionParams {
  rpc: DepinRpc | null;
  network: string;
  identity: DepinChatIdentity | null;
}

interface AssetSelectionActions {
  checkAssetValidity: () => void;
  onAssetSelected: () => void;
  setIsPolling: (value: boolean) => void;
}

/** Selects a token and resolves its DePIN-capable holders for private chats. */
const useDepinChatAssetSelection = ({ rpc, network, identity }: UseDepinChatAssetSelectionParams) => {
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [recipientList, setRecipientList] = useState<RecipientInfo[]>([]);

  const selectionRef = useRef({ identity: identity?.address, network, token: selectedAsset });
  selectionRef.current = { identity: identity?.address, network, token: selectedAsset };
  const requestRef = useRef(0);
  const refreshRecipients = useCallback(
    async (assetName?: string) => {
      const token = assetName ?? selectedAsset;
      if (!rpc || !token || !identity) return;
      const request = ++requestRef.current;
      const pool = await getVerifiedPool({ call: rpc, network, url: getDepinRpcConfig(network as 'mainnet' | 'testnet').url });
      const pairs = await verifiedRecipients({
        call: rpc,
        pool,
        token,
        senderAddress: identity.address,
        senderPubKey: identity.publicKey,
        network,
      });
      const current = selectionRef.current;
      if (request === requestRef.current && current.identity === identity.address && current.network === network && current.token === token)
        setRecipientList(pairs);
    },
    [rpc, selectedAsset, identity, network],
  );

  const selectAsset = useCallback(
    async (assetName: string, { checkAssetValidity, onAssetSelected, setIsPolling }: AssetSelectionActions) => {
      if (!rpc) return;
      setSelectedAsset(assetName);
      setRecipientList([]);
      onAssetSelected();
      setIsPolling(true);
      try {
        await refreshRecipients(assetName);
      } catch (error) {
        console.debug('DePINChat: failed to load recipients', error);
      }
      checkAssetValidity();
    },
    [rpc, refreshRecipients],
  );

  return { refreshRecipients, recipientList, selectAsset, selectedAsset, setSelectedAsset };
};

export default useDepinChatAssetSelection;
