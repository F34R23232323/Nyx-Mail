import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../theme/ThemeProvider";
import { radius, spacing } from "../theme/tokens";
import { AppText } from "../components/ui/AppText";
import { Touchable } from "../components/ui/Touchable";
import { useMailData } from "../lib/mail-data";

const ICONS: Record<string, { icon: keyof typeof Feather.glyphMap; active: keyof typeof Feather.glyphMap; label: string }> = {
  Mail: { icon: "inbox", active: "inbox", label: "Mail" },
  Search: { icon: "search", active: "search", label: "Search" },
  Contacts: { icon: "users", active: "users", label: "People" },
  Settings: { icon: "settings", active: "settings", label: "Settings" },
};

function TabItem({
  focused,
  icon,
  activeIcon,
  label,
  badge,
  onPress,
  accessibilityLabel,
}: {
  focused: boolean;
  icon: keyof typeof Feather.glyphMap;
  activeIcon: keyof typeof Feather.glyphMap;
  label: string;
  badge?: number;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const palette = usePalette();
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const badgeScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
    }).start();
  }, [focused, progress]);

  useEffect(() => {
    if (!badge) return;
    Animated.sequence([
      Animated.timing(badgeScale, { toValue: 1.25, duration: 140, useNativeDriver: true }),
      Animated.spring(badgeScale, {
        toValue: 1,
        useNativeDriver: true,
        damping: 10,
        stiffness: 260,
      }),
    ]).start();
  }, [badge, badgeScale]);

  const iconScale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const iconLift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });

  return (
    <Touchable
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      haptic="light"
      onPress={onPress}
      style={styles.item}
    >
      <View style={styles.iconWrap}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: 14,
              backgroundColor: palette.accentSoft,
              opacity: progress,
              transform: [{ scale: progress }],
            },
          ]}
        />
        <Animated.View style={{ transform: [{ scale: iconScale }, { translateY: iconLift }] }}>
          <Feather
            name={focused ? activeIcon : icon}
            size={19}
            color={focused ? palette.accentStrong : palette.faint}
          />
        </Animated.View>
        {badge ? (
          <Animated.View
            style={[
              styles.badge,
              {
                backgroundColor: palette.pink,
                borderColor: palette.tabBar,
                transform: [{ scale: badgeScale }],
              },
            ]}
          >
            <AppText
              variant="micro"
              color="#FFFFFF"
              style={{ fontSize: 8, lineHeight: 10, letterSpacing: 0 }}
            >
              {badge > 99 ? "99+" : String(badge)}
            </AppText>
          </Animated.View>
        ) : null}
      </View>
      <AppText
        variant="micro"
        color={focused ? palette.ink : palette.faint}
        style={{ fontSize: 9, letterSpacing: 0.2, lineHeight: 11 }}
      >
        {label}
      </AppText>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: palette.accentStrong,
            opacity: progress,
            transform: [{ scale: progress }],
          },
        ]}
      />
    </Touchable>
  );
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { unread } = useMailData();

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: palette.tabBar,
          borderColor: palette.border,
          bottom: Math.max(insets.bottom, spacing.md),
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const config = ICONS[route.name] ?? ICONS.Mail;
        return (
          <TabItem
            key={route.key}
            focused={focused}
            icon={config.icon}
            activeIcon={config.active}
            label={config.label}
            badge={route.name === "Mail" ? unread : undefined}
            accessibilityLabel={config.label}
            onPress={() => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    height: 66,
    borderRadius: radius.xl + 2,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    height: 60,
  },
  iconWrap: {
    width: 42,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -3,
    right: 1,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    marginTop: 1,
  },
});
