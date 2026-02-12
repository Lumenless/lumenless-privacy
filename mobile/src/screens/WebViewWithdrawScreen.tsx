import React, { useRef, useCallback, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  SafeAreaView,
  Alert,
  Platform,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Buffer } from 'buffer';
import { colors, spacing, typography } from '../theme';
import { logEvent, analyticsEvents } from '../services/firebase';

// URL for the web-based withdraw page
const WITHDRAW_WEB_URL = process.env.EXPO_PUBLIC_LUMENLESS_WEB_URL 
  ? `${process.env.EXPO_PUBLIC_LUMENLESS_WEB_URL}/privacycash/withdraw`
  : 'https://lumenless.com/privacycash/withdraw';

export type WebViewWithdrawParams = {
  token?: 'SOL' | 'USDC' | 'USDT';
  recipient?: string;
  amount?: string;
  walletAddress?: string;
  // Note: callbacks can't be passed via navigation params
  // Success is communicated back via navigation focus event
};

type WebViewWithdrawScreenRouteProp = RouteProp<{ WebViewWithdraw: WebViewWithdrawParams }, 'WebViewWithdraw'>;

interface WebViewMessage {
  type: string;
  tx?: string;
  error?: string;
  address?: string;
  balances?: { SOL: number; USDC: number; USDT: number };
  token?: string;
  amount?: string;
  recipient?: string;
  message?: string; // For sign_message requests (base64 encoded)
  requestId?: string; // For matching signature responses
}

export default function WebViewWithdrawScreen() {
  const navigation = useNavigation<StackNavigationProp<Record<string, WebViewWithdrawParams>>>();
  const route = useRoute<WebViewWithdrawScreenRouteProp>();
  const webViewRef = useRef<WebView>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Build URL with params
  const params = route.params || {};
  const urlParams = new URLSearchParams();
  urlParams.set('mobile', 'true');
  if (params.token) urlParams.set('token', params.token);
  if (params.recipient) urlParams.set('recipient', params.recipient);
  if (params.amount) urlParams.set('amount', params.amount);
  if (params.walletAddress) urlParams.set('walletAddress', params.walletAddress);
  
  const webUrl = `${WITHDRAW_WEB_URL}?${urlParams.toString()}`;
  
  // Sign a message using MWA and send the signature back to WebView
  const handleSignMessage = useCallback(async (messageBase64: string, requestId: string) => {
    try {
      console.log('[WebViewWithdraw] Sign message requested, requestId:', requestId);
      
      await transact(async (wallet) => {
        // Authorize first
        const authResult = await wallet.authorize({
          identity: {
            name: 'Lumenless',
            uri: 'https://lumenless.com',
            icon: 'https://lumenless.com/logo.svg',
          },
          cluster: 'mainnet-beta',
        });
        
        // Decode the base64 message
        const messageBytes = new Uint8Array(Buffer.from(messageBase64, 'base64'));
        
        // Sign the message
        const signResult = await wallet.signMessages({
          addresses: [authResult.accounts[0].address],
          payloads: [messageBytes],
        });
        
        // Encode signature as base64
        const signatureBytes = signResult[0];
        const signatureBase64 = Buffer.from(signatureBytes).toString('base64');
        
        // Send signature back to WebView
        const responseScript = `
          window.postMessage(JSON.stringify({
            type: 'sign_message_response',
            requestId: '${requestId}',
            signature: '${signatureBase64}',
            address: '${authResult.accounts[0].address}'
          }), '*');
          true;
        `;
        webViewRef.current?.injectJavaScript(responseScript);
        
        console.log('[WebViewWithdraw] Signature sent back to WebView');
      });
    } catch (err) {
      console.error('[WebViewWithdraw] Sign message error:', err);
      // Send error back to WebView
      const errorMessage = err instanceof Error ? err.message : 'Signing failed';
      const errorScript = `
        window.postMessage(JSON.stringify({
          type: 'sign_message_error',
          requestId: '${requestId}',
          error: '${errorMessage.replace(/'/g, "\\'")}'
        }), '*');
        true;
      `;
      webViewRef.current?.injectJavaScript(errorScript);
    }
  }, []);
  
  // Handle messages from the WebView
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as WebViewMessage;
      console.log('[WebViewWithdraw] Message from web:', data.type);
      
      switch (data.type) {
        case 'connected':
          console.log('[WebViewWithdraw] Wallet connected:', data.address);
          break;
          
        case 'balances':
          console.log('[WebViewWithdraw] Balances received:', data.balances);
          break;
        
        case 'sign_message':
          // WebView is requesting a signature via MWA
          if (data.message && data.requestId) {
            handleSignMessage(data.message, data.requestId);
          } else {
            console.error('[WebViewWithdraw] Invalid sign_message request');
          }
          break;
          
        case 'withdraw_success':
          console.log('[WebViewWithdraw] Withdraw success:', data.tx);
          logEvent(analyticsEvents.withdraw, { 
            token: data.token, 
            amount: data.amount,
            source: 'webview',
          });
          
          // Show success alert
          Alert.alert(
            'Withdrawal Successful',
            `Transaction: ${data.tx?.slice(0, 20)}...`,
            [
              {
                text: 'View on Explorer',
                onPress: () => {
                  // Could open in browser using Linking
                },
              },
              {
                text: 'Done',
                onPress: () => {
                  // Navigate back - the previous screen will refresh on focus
                  navigation.goBack();
                },
              },
            ]
          );
          break;
          
        case 'withdraw_error':
          console.log('[WebViewWithdraw] Withdraw error:', data.error);
          // Error is already shown in the WebView
          break;
          
        case 'close':
          console.log('[WebViewWithdraw] Close requested');
          navigation.goBack();
          break;
          
        default:
          console.log('[WebViewWithdraw] Unknown message type:', data.type);
      }
    } catch (err) {
      console.error('[WebViewWithdraw] Error parsing message:', err);
    }
  }, [navigation, handleSignMessage]);
  
  // Handle WebView errors
  const handleError = useCallback((syntheticEvent: { nativeEvent: { description: string } }) => {
    const { description } = syntheticEvent.nativeEvent;
    console.error('[WebViewWithdraw] WebView error:', description);
    setError(`Failed to load: ${description}`);
    setIsLoading(false);
  }, []);
  
  // Handle WebView load end
  const handleLoadEnd = useCallback(() => {
    setIsLoading(false);
  }, []);
  
  // Inject script to set up mobile WebView environment
  const injectedJavaScript = `
    (function() {
      console.log('[Lumenless] Injected JS starting, ReactNativeWebView exists:', !!window.ReactNativeWebView);
      
      // Store original postMessage
      var originalPostMessage = window.postMessage;
      
      // Override window.postMessage to also dispatch an event
      // This ensures our message listener catches injected messages
      window.postMessage = function(message, targetOrigin) {
        // Call original
        originalPostMessage.call(window, message, targetOrigin);
        
        // Also dispatch a custom event that the page can listen to
        try {
          var event = new MessageEvent('message', {
            data: message,
            origin: window.location.origin
          });
          window.dispatchEvent(event);
        } catch(e) {
          console.error('[Lumenless] Error dispatching message event:', e);
        }
      };
      
      // Notify the page that we're in mobile mode
      window.__LUMENLESS_MOBILE__ = true;
      
      console.log('[Lumenless] Mobile WebView mode enabled');
      
      true; // Required for Android
    })();
  `;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable 
          onPress={() => navigation.goBack()} 
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Withdraw</Text>
        <View style={styles.headerSpacer} />
      </View>
      
      {/* Loading Overlay */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}
      
      {/* Error State */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable 
            style={styles.retryBtn}
            onPress={() => {
              setError(null);
              setIsLoading(true);
              webViewRef.current?.reload();
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      )}
      
      {/* WebView */}
      {!error && (
        <WebView
          ref={webViewRef}
          source={{ uri: webUrl }}
          style={styles.webView}
          onMessage={handleMessage}
          onError={handleError}
          onLoadEnd={handleLoadEnd}
          injectedJavaScript={injectedJavaScript}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          scalesPageToFit={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          // Enable mixed content for development
          mixedContentMode="compatibility"
          // Allow file access for WASM
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          // iOS specific
          allowsBackForwardNavigationGestures={true}
          // User agent to help with wallet detection
          userAgent={Platform.select({
            ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Lumenless/1.0',
            android: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Lumenless/1.0',
          })}
          // Handle deep links from wallet apps
          onShouldStartLoadWithRequest={(request) => {
            const { url } = request;
            
            // Allow navigation within the web app
            if (url.startsWith(WITHDRAW_WEB_URL) || url.startsWith('https://lumenless.com')) {
              return true;
            }
            
            // Handle wallet deep links - let the system handle them
            if (url.startsWith('solana:') || url.startsWith('solflare:') || url.startsWith('phantom:')) {
              // Could use Linking.openURL(url) here if needed
              return false;
            }
            
            // Allow other https URLs (like explorer links)
            if (url.startsWith('https://')) {
              return true;
            }
            
            return false;
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
  },
  backBtnText: {
    ...typography.body,
    color: colors.accent,
  },
  headerTitle: {
    ...typography.subtitle,
    color: colors.text,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 60, // Match back button width for centering
  },
  webView: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 8,
  },
  retryBtnText: {
    ...typography.button,
    color: colors.text,
  },
});
