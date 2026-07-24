import { useCallback, useState } from 'react';

import type { RecipientInfo } from './useDePINChat';
import type { DepinRpc } from './useDepinChatSetup';

interface UseDepinChatAssetSelectionParams {
  rpc: DepinRpc | null;
}

interface AssetSelectionActions {
  checkAssetValidity: () => void;
  onAssetSelected: () => void;
  setIsPolling: (value: boolean) => void;
}

/** Selects a token and resolves its DePIN-capable holders for private chats. */
const useDepinChatAssetSelection = ({ rpc }: UseDepinChatAssetSelectionParams) => {
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [recipientList, setRecipientList] = useState<RecipientInfo[]>([]);

  const selectAsset = useCallback(
    async (assetName: string, { checkAssetValidity, onAssetSelected, setIsPolling }: AssetSelectionActions) => {
      if (!rpc) return;
      setSelectedAsset(assetName);
      onAssetSelected();
      setIsPolling(true);
      try {
        const [depinAddresses, addressesByAsset] = await Promise.all([
          rpc('listdepinaddresses', [assetName]) as Promise<Array<{ address: string; pubkey?: string }>>,
          rpc('listaddressesbyasset', [assetName]) as Promise<Record<string, unknown>>,
        ]);
        const pubkeyByAddress = new Map<string, string>();
        for (const address of depinAddresses ?? []) if (address.pubkey) pubkeyByAddress.set(address.address, address.pubkey);
        setRecipientList(
          Object.keys(addressesByAsset ?? {}).map(address => ({
            address,
            pubkey: pubkeyByAddress.get(address) ?? null,
          })),
        );
      } catch (error) {
        console.debug('DePINChat: failed to load recipients', error);
      }
      checkAssetValidity();
    },
    [rpc],
  );

  return { recipientList, selectAsset, selectedAsset, setSelectedAsset };
};

export default useDepinChatAssetSelection;
