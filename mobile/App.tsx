import "react-native-gesture-handler";
import React, { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_800ExtraBold } from "@expo-google-fonts/inter/800ExtraBold";
import { ThemeProvider, useTheme } from "./src/theme/ThemeProvider";
import { ToastProvider } from "./src/components/ui/Toast";
import { ConfirmProvider } from "./src/components/ui/ConfirmDialog";
import { AuthProvider } from "./src/lib/auth";
import { MailDataProvider } from "./src/lib/mail-data";
import { ComposeProvider } from "./src/compose/ComposeProvider";
import { RootNavigator } from "./src/navigation/RootNavigator";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function AppShell() {
  const { palette } = useTheme();

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.canvas).catch(() => undefined);
  }, [palette.canvas]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <StatusBar style={palette.mode === "dark" ? "light" : "dark"} />
      <RootNavigator />
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>
                <MailDataProvider>
                  <ComposeProvider>
                    <AppShell />
                  </ComposeProvider>
                </MailDataProvider>
              </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
