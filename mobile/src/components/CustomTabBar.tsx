import { View, TouchableOpacity, StyleSheet, Dimensions, Animated, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRef, useEffect } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Logo, PayLinkIcon } from './index';

const { width } = Dimensions.get('window');
const TAB_BAR_WIDTH = width - 48;
const TAB_WIDTH = TAB_BAR_WIDTH / 2;

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const indicatorPosition = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(indicatorPosition, {
      toValue: state.index * TAB_WIDTH,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  }, [state.index]);

  return (
    <View style={styles.container}>
      <BlurView intensity={40} tint="dark" style={styles.blurContainer}>
        <View style={styles.tabBar}>
          {/* Animated indicator */}
          <Animated.View
            style={[
              styles.indicator,
              { transform: [{ translateX: indicatorPosition }] },
            ]}
          />

          {state.routes.map((route, index) => {
            const isFocused = state.index === index;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <TabButton
                key={route.key}
                routeName={route.name}
                isFocused={isFocused}
                onPress={onPress}
              />
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

interface TabButtonProps {
  routeName: string;
  isFocused: boolean;
  onPress: () => void;
}

function TabButton({ routeName, isFocused, onPress }: TabButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(isFocused ? 1 : 0.5)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: isFocused ? 1 : 0.5,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isFocused]);

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.9,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const getIcon = () => {
    const color = '#fff';
    const size = 22;

    if (routeName === 'Lumen') {
      return <Logo size={size} color={color} />;
    }
    return <PayLinkIcon size={size} color={color} />;
  };

  const getLabel = () => {
    if (routeName === 'Lumen') return 'LUMEN';
    return 'PAY LINKS';
  };

  return (
    <TouchableOpacity
      style={styles.tabButton}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
    >
      <Animated.View
        style={[
          styles.tabContent,
          { transform: [{ scale }], opacity },
        ]}
      >
        {getIcon()}
        <Text style={styles.label}>{getLabel()}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
  },
  blurContainer: {
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  tabBar: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: 'rgba(20, 20, 20, 0.8)',
  },
  indicator: {
    position: 'absolute',
    width: TAB_WIDTH - 12,
    height: 48,
    backgroundColor: 'rgba(128, 0, 255, 0.3)',
    borderRadius: 20,
    top: 8,
    left: 6,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 1,
  },
});
