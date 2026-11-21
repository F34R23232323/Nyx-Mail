import React from "react";
import { StyleSheet, View } from "react-native";
import { DefaultTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LinearGradient } from "expo-linear-gradient";
import { usePalette } from "../theme/ThemeProvider";
import { useAuth } from "../lib/auth";
import { spacing } from "../theme/tokens";
import { AppText } from "../components/ui/AppText";
import { LogoMark } from "../components/ui/Logo";
import { TabBar } from "./TabBar";
import type { MainTabParamList, RootStackParamList } from "./types";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { MfaScreen } from "../screens/auth/MfaScreen";
import { SetupScreen } from "../screens/auth/SetupScreen";
import { UnlockScreen } from "../screens/auth/UnlockScreen";
import { SignupScreen } from "../screens/auth/SignupScreen";
import { InboxScreen } from "../screens/mail/InboxScreen";
import { ThreadScreen } from "../screens/mail/ThreadScreen";
import { SearchScreen } from "../screens/search/SearchScreen";
import { ContactsScreen } from "../screens/contacts/ContactsScreen";
import { SettingsScreen } from "../screens/settings/SettingsScreen";
import { AccountScreen } from "../screens/settings/AccountScreen";
import { AppearanceScreen } from "../screens/settings/AppearanceScreen";
import { SecurityScreen } from "../screens/settings/SecurityScreen";
import { FoldersScreen } from "../screens/settings/FoldersScreen";
import { LabelsScreen } from "../screens/settings/LabelsScreen";
import { AliasesScreen } from "../screens/settings/AliasesScreen";
import { AboutScreen } from "../screens/settings/AboutScreen";
import { BackupCodesOverlay } from "../components/auth/BackupCodesOverlay";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
        animation: "fade",
      }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen name="Mail" component={InboxScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Contacts" component={ContactsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export function SplashScreen() {
  const palette = usePalette();
  return (
    <View style={[styles.splash, { backgroundColor: palette.canvas }]}>
      <LinearGradient
        colors={["rgba(138,120,255,0.18)", "rgba(8,9,13,0)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.splashCenter}>
        <LogoMark size={76} />
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <AppText variant="display" weight="bold">
            Nyx<AppText variant="display" weight="bold" color={palette.accentStrong}>Mail</AppText>
          </AppText>
          <View style={[styles.lockChip, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={[styles.dot, { backgroundColor: palette.mint }]} />
            <AppText variant="caption" color={palette.muted}>
              Zero-access encryption
            </AppText>
          </View>
        </View>
      </View>
    </View>
  );
}

export function RootNavigator() {
  const palette = usePalette();
  const { stage, pendingSetup } = useAuth();

  const theme: Theme = {
    ...DefaultTheme,
    dark: palette.mode === "dark",
    colors: {
      ...DefaultTheme.colors,
      primary: palette.accent,
      background: palette.canvas,
      card: palette.canvas,
      text: palette.ink,
      border: palette.border,
      notification: palette.pink,
    },
  };

  if (stage === "booting") return <SplashScreen />;

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          contentStyle: { backgroundColor: palette.canvas },
        }}
      >
        {stage === "signedOut" ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ animation: "fade" }} />
            <Stack.Screen
              name="Signup"
              component={SignupScreen}
              options={{ presentation: "modal", animation: "slide_from_bottom" }}
            />
          </>
        ) : null}

        {stage === "mfa" ? (
          <Stack.Screen
            name="Mfa"
            component={pendingSetup ? SetupScreen : MfaScreen}
            options={{ animation: "fade" }}
          />
        ) : null}

        {stage === "locked" ? (
          <Stack.Screen name="Unlock" component={UnlockScreen} options={{ animation: "fade" }} />
        ) : null}

        {stage === "signedIn" ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ animation: "fade" }} />
            <Stack.Screen name="Thread" component={ThreadScreen} />
            <Stack.Screen name="Account" component={AccountScreen} />
            <Stack.Screen name="Appearance" component={AppearanceScreen} />
            <Stack.Screen name="Security" component={SecurityScreen} />
            <Stack.Screen name="Folders" component={FoldersScreen} />
            <Stack.Screen name="Labels" component={LabelsScreen} />
            <Stack.Screen name="Aliases" component={AliasesScreen} />
            <Stack.Screen name="About" component={AboutScreen} />
          </>
        ) : null}
      </Stack.Navigator>
      {stage === "signedIn" ? <BackupCodesOverlay /> : null}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
  splashCenter: { alignItems: "center", gap: spacing.xxl },
  lockChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
