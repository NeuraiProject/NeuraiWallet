/**
 * Hidden WebView that runs the C6 proving engine (see `privacy-host/` and
 * `blue_modules/neurai/privacy/bridge.ts`). Mounted only while the privacy
 * screen is open; children reach the bridge with `usePrivacyHost()`.
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { PrivacyHostBridge } from '../../blue_modules/neurai/privacy/bridge';
import { PRIVACY_HOST_HTML } from '../../blue_modules/neurai/privacy/hostHtml.generated';

type HostWebViewHandle = { injectJavaScript(script: string): void };
// react-native-webview declares `WebView<P = undefined>` with props `WebViewProps & P`,
// which TypeScript 5 reduces to `never`; type the component explicitly.
const HostWebView = WebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<HostWebViewHandle> }>;

/** Base URL the page is loaded under (never fetched: the page makes no requests). */
const HOST_ORIGIN = 'https://privacy-host.neurai.invalid/';
/** react-native-webview matches whitelist entries against the origin, which has no trailing slash. */
const HOST_WHITELIST = ['https://privacy-host.neurai.invalid'];

const PrivacyHostContext = createContext<PrivacyHostBridge | null>(null);

export function usePrivacyHost(): PrivacyHostBridge {
  const bridge = useContext(PrivacyHostContext);
  if (!bridge) throw new Error('usePrivacyHost must be used inside PrivacyHostProvider');
  return bridge;
}

export function PrivacyHostProvider({ children }: { children: React.ReactNode }) {
  const webView = useRef<HostWebViewHandle>(null);
  // A new key remounts the WebView after its renderer process died.
  const [generation, setGeneration] = useState(0);
  const bridge = useMemo(
    () =>
      new PrivacyHostBridge({
        send: text =>
          webView.current?.injectJavaScript(
            `window.__neuraiPrivacyHost&&window.__neuraiPrivacyHost.receive(${JSON.stringify(text)});true;`,
          ),
      }),
    [],
  );
  useEffect(() => () => bridge.dispose(), [bridge]);

  const restart = (reason: string) => {
    bridge.crashed(reason);
    setGeneration(g => g + 1);
  };

  return (
    <PrivacyHostContext.Provider value={bridge}>
      {children}
      <View style={styles.hidden} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <HostWebView
          key={generation}
          ref={webView}
          source={{ html: PRIVACY_HOST_HTML, baseUrl: HOST_ORIGIN }}
          originWhitelist={HOST_WHITELIST}
          onShouldStartLoadWithRequest={(request: { url: string }) => request.url === HOST_ORIGIN || request.url === 'about:blank'}
          onMessage={(event: WebViewMessageEvent) => bridge.receive(event.nativeEvent.data)}
          onRenderProcessGone={() => restart('The privacy engine ran out of memory or crashed; open the private wallet again')}
          onContentProcessDidTerminate={() => restart('The privacy engine stopped; open the private wallet again')}
          javaScriptEnabled
          domStorageEnabled={false}
          cacheEnabled={false}
          incognito
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          textInteractionEnabled={false}
        />
      </View>
    </PrivacyHostContext.Provider>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
