import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";

interface ScreenProps extends ViewProps {
  padded?: boolean;
  topInset?: boolean;
  bottomInset?: boolean;
  edges?: { top?: boolean; bottom?: boolean };
}

export function Screen({
  children,
  style,
  padded = false,
  topInset = false,
  bottomInset = false,
  edges,
  ...rest
}: ScreenProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const showTop = edges?.top ?? topInset;
  const showBottom = edges?.bottom ?? bottomInset;
  return (
    <View
      {...rest}
      style={[
        styles.root,
        {
          backgroundColor: palette.canvas,
          paddingTop: showTop ? insets.top : 0,
          paddingBottom: showBottom ? insets.bottom : 0,
          paddingHorizontal: padded ? spacing.xl : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Hairline({ style }: { style?: ViewProps["style"] }) {
  const palette = usePalette();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: palette.borderSoft }, style]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
