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
  
  const webUrl = `${WITHDRAW_WEB_URL}?${urlParams.toString()}`;
  
  // Handle messages from the WebView
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as WebViewMessage;
      console.log('[WebViewWithdraw] Message from web:', data.type, data);
      
      switch (data.type) {
        case 'connected':
          console.log('[WebViewWithdraw] Wallet connected:', data.address);
          break;
          
        case 'balances':
          console.log('[WebViewWithdraw] Balances received:', data.balances);
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
  }, [navigation, params]);
  
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
  
  // Inject script to detect wallet connection
  const injectedJavaScript = `
    (function() {
      // Ensure ReactNativeWebView is available
      if (!window.ReactNativeWebView) {
        window.ReactNativeWebView = {
          postMessage: function(msg) {
            window.postMessage(msg, '*');
          }
        };
      }
      
      // Log that we're in mobile mode
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
