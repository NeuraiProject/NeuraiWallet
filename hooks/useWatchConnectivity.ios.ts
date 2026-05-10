import { useCallback, useEffect, useRef } from 'react';
import {
  transferCurrentComplicationUserInfo,
  updateApplicationContext,
  useInstalled,
  usePaired,
  useReachability,
  watchEvents,
} from 'react-native-watch-connectivity';
import loc from '../loc';
import { Chain } from '../models/xnaUnits';
import { FiatUnit } from '../models/fiatUnit';
import { useSettings } from '../hooks/context/useSettings';
import { useStorage } from '../hooks/context/useStorage';
import { Transaction } from '../class/wallets/types';

interface Message {
  request?: string;
  message?: string;
  walletIndex?: number;
  amount?: number;
  description?: string;
  hideBalance?: boolean;
}

interface Reply {
  (response: Record<string, any>): void;
}

export function useWatchConnectivity() {
  const { walletsInitialized, wallets, fetchWalletTransactions, saveToDisk, txMetadata } = useStorage();
  const { preferredFiatCurrency } = useSettings();
  const isReachable = useReachability();
  const isInstalled = useInstalled();
  const isPaired = usePaired();

  const messagesListenerActive = useRef(false);
  const lastPreferredCurrency = useRef(FiatUnit.USD.endPointKey);

  const createContextPayload = () => ({
    randomID: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
  });

  useEffect(() => {
    if (!isInstalled || !isPaired || !walletsInitialized || !isReachable) return;

    const contextPayload = createContextPayload();
    try {
      updateApplicationContext(contextPayload);
      console.debug('Transferred user info:', contextPayload);
    } catch (error) {
      console.error('Failed to transfer user info:', error);
    }
  }, [isReachable, walletsInitialized, isInstalled, isPaired]);

  useEffect(() => {
    if (!isInstalled || !isPaired || !walletsInitialized || !isReachable || !preferredFiatCurrency) return;

    if (lastPreferredCurrency.current !== preferredFiatCurrency.endPointKey) {
      try {
        const currencyPayload = { preferredFiatCurrency: preferredFiatCurrency.endPointKey };
        transferCurrentComplicationUserInfo(currencyPayload);
        lastPreferredCurrency.current = preferredFiatCurrency.endPointKey;
        console.debug('Apple Watch: updated preferred fiat currency', currencyPayload);
      } catch (error) {
        console.error('Error updating preferredFiatCurrency on watch:', error);
      }
    } else {
      console.debug('WatchConnectivity: preferred currency has not changed');
    }
  }, [preferredFiatCurrency, walletsInitialized, isReachable, isInstalled, isPaired]);

  const constructWalletsToSendToWatch = useCallback(async () => {
    if (!Array.isArray(wallets) || !walletsInitialized) return;

    const walletsToProcess = await Promise.allSettled(
      wallets.map(async wallet => {
        try {
          const receiveAddress = await wallet.getAddressAsync();
          const transactions: Partial<Transaction>[] = wallet
            .getTransactions()
            .slice(0, 10)
            .map((transaction: Transaction) => ({
              type: determineTransactionType(transaction),
              amount: transaction.value ?? 0,
              memo: txMetadata[transaction.hash]?.memo || '',
              time: transaction.timestamp ?? transaction.time,
            }));

          const walletData = {
            label: wallet.getLabel(),
            balance: Number(wallet.getBalance()),
            type: wallet.type,
            preferredBalanceUnit: wallet.getPreferredBalanceUnit(),
            receiveAddress,
            transactions,
            chain: wallet.chain,
            hideBalance: wallet.hideBalance ? 1 : 0,
            xpub: wallet.getXpub() || wallet.getSecret(),
          };

          console.debug('Constructed wallet data for watch:', {
            label: walletData.label,
            type: walletData.type,
            preferredBalanceUnit: walletData.preferredBalanceUnit,
            transactionCount: transactions.length,
          });
          return walletData;
        } catch (error) {
          console.error('Failed to construct wallet data:', error);
          return null;
        }
      }),
    );

    const processedWallets = walletsToProcess
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => (result as PromiseFulfilledResult<any>).value);

    console.debug('Constructed wallets to process for Apple Watch:', {
      walletCount: processedWallets.length,
      walletLabels: processedWallets.map(wallet => wallet.label),
    });
    return { wallets: processedWallets, randomID: `${Date.now()}${Math.floor(Math.random() * 1000)}` };
  }, [wallets, walletsInitialized, txMetadata]);

  const determineTransactionType = (transaction: Transaction): string => {
    if ((transaction.confirmations ?? 0) < 3) return 'pending_transaction';
    if ((transaction.value ?? 0) < 0) return 'outgoing_transaction';
    return 'incoming_transaction';
  };

  const handleMessages = useCallback(
    async (message: Message, reply: Reply) => {
      console.debug('Received message from Apple Watch:', message);
      try {
        if (message.message === 'sendApplicationContext') {
          const walletsToProcess = await constructWalletsToSendToWatch();
          if (walletsToProcess) {
            updateApplicationContext(walletsToProcess);
            console.debug('Transferred user info on request:', walletsToProcess);
          }
        } else if (message.message === 'fetchTransactions') {
          await fetchWalletTransactions();
          await saveToDisk();
          reply({});
        } else if (
          message.message === 'hideBalance' &&
          typeof message.walletIndex === 'number' &&
          typeof message.hideBalance === 'boolean' &&
          message.walletIndex >= 0 &&
          message.walletIndex < wallets.length
        ) {
          wallets[message.walletIndex].hideBalance = message.hideBalance;
          await saveToDisk();
          reply({});
        }
      } catch (error) {
        console.error('Error handling message:', error);
        reply({});
      }
    },
    [fetchWalletTransactions, saveToDisk, wallets, constructWalletsToSendToWatch],
  );

  useEffect(() => {
    if (!isInstalled || !isPaired || !walletsInitialized) return;

    const sendWalletData = async () => {
      try {
        const walletsToProcess = await constructWalletsToSendToWatch();
        if (walletsToProcess) {
          updateApplicationContext(walletsToProcess);
          console.debug('Apple Watch: sent wallet data via transferUserInfo', walletsToProcess);
        }
      } catch (error) {
        console.error('Failed to send wallets to watch:', error);
      }
    };
    sendWalletData();
  }, [walletsInitialized, isInstalled, isPaired, constructWalletsToSendToWatch]);

  useEffect(() => {
    if (!isInstalled) return;

    const unsubscribe = watchEvents.addListener('message', (message: any) => {
      if (message.request === 'wakeUpApp') {
        console.debug('Received wake-up request from Apple Watch');
      } else {
        handleMessages(message, () => {});
      }
    });

    messagesListenerActive.current = true;
    console.debug('Message listener set up for Apple Watch');

    return () => {
      unsubscribe();
      messagesListenerActive.current = false;
      console.debug('Message listener for Apple Watch cleaned up');
    };
  }, [isInstalled, handleMessages]);
}

export default useWatchConnectivity;