import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { AppText } from "../ui/AppText";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  error?: boolean;
  onComplete?: (value: string) => void;
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus = true,
  error = false,
  onComplete,
}: OtpInputProps) {
  const palette = usePalette();
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(autoFocus);
  const digits = value.padEnd(length, " ").split("").slice(0, length);
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      style={styles.wrap}
      accessibilityLabel="Authentication code"
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(next) => {
          const cleaned = next.replace(/\D/g, "").slice(0, length);
          onChange(cleaned);
          if (cleaned.length === length) onComplete?.(cleaned);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={length}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.hidden}
        caretHidden
      />
      <View style={styles.boxes}>
        {digits.map((digit, index) => {
          const isActive = focused && index === activeIndex;
          return (
            <View
              key={index}
              style={[
                styles.box,
                {
                  backgroundColor: palette.surface,
                  borderColor: error
                    ? palette.danger
                    : isActive
                      ? palette.accent
                      : digit.trim()
                        ? palette.borderStrong
                        : palette.border,
                  borderWidth: isActive ? 1.5 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <AppText variant="title" weight="semibold" align="center" style={{ fontVariant: ["tabular-nums"] }}>
                {digit.trim()}
              </AppText>
              {isActive && !digit.trim() ? (
                <View style={[styles.caret, { backgroundColor: palette.accent }]} />
              ) : null}
            </View>
          );
        })}
      </View>
      <AppText variant="caption" color={palette.faint} align="center">
        Enter the 6-digit code from your authenticator
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  hidden: {
    position: "absolute",
    opacity: 0,
    width: 1,
    height: 1,
  },
  boxes: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
  },
  box: {
    flex: 1,
    maxWidth: 54,
    height: 62,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  caret: {
    position: "absolute",
    width: 2,
    height: 22,
    borderRadius: 1,
  },
});
