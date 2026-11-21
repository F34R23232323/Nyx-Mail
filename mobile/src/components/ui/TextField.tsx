import React, { forwardRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "./AppText";
import { IconButton } from "./IconButton";
import { Touchable } from "./Touchable";

interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: keyof typeof Feather.glyphMap;
  rightIcon?: keyof typeof Feather.glyphMap;
  onRightPress?: () => void;
  secure?: boolean;
  loading?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export const TextField = forwardRef<React.ComponentRef<typeof TextInput>, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    icon,
    rightIcon,
    onRightPress,
    secure,
    loading,
    containerStyle,
    style,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const palette = usePalette();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);

  return (
    <View style={[{ gap: spacing.sm }, containerStyle]}>
      {label ? (
        <AppText variant="label" color={focused ? palette.accentStrong : palette.muted}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: palette.surface,
            borderColor: error ? palette.danger : focused ? palette.accent : palette.border,
            borderWidth: focused ? 1.5 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        {icon ? (
          <Feather name={icon} size={17} color={focused ? palette.accent : palette.faint} />
        ) : null}
        <TextInput
          ref={ref}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          secureTextEntry={secure ? !visible : rest.secureTextEntry}
          placeholderTextColor={palette.faint}
          selectionColor={palette.accent}
          cursorColor={palette.accent}
          style={[
            styles.input,
            {
              color: palette.ink,
              fontFamily: "Inter_400Regular",
              paddingVertical: rest.multiline ? spacing.md : 0,
            },
            style,
          ]}
        />
        {loading ? <ActivityIndicator size="small" color={palette.accent} /> : null}
        {secure ? (
          <Touchable
            onPress={() => setVisible((value) => !value)}
            accessibilityLabel={visible ? "Hide password" : "Show password"}
            haptic="none"
            style={{ padding: 4 }}
          >
            <Feather name={visible ? "eye-off" : "eye"} size={17} color={palette.faint} />
          </Touchable>
        ) : rightIcon ? (
          <IconButton
            name={rightIcon}
            onPress={onRightPress}
            size={30}
            iconSize={17}
            color={palette.faint}
            accessibilityLabel={rightIcon}
          />
        ) : null}
      </View>
      {error ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Feather name="alert-circle" size={12} color={palette.danger} />
          <AppText variant="caption" color={palette.danger}>
            {error}
          </AppText>
        </View>
      ) : hint ? (
        <AppText variant="caption" color={palette.faint}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    minHeight: 52,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  input: {
    flex: 1,
    fontSize: 15,
    padding: 0,
    minHeight: 50,
    textAlignVertical: "center",
  },
});
