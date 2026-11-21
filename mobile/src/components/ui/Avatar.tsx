import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { usePalette } from "../../theme/ThemeProvider";
import { loadAvatarUri } from "../../lib/avatar-cache";
import { AppText } from "./AppText";

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result);
}

export function initials(name?: string | null, email?: string | null): string {
  const source = (name || "").trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }
  const local = (email || "?").split("@")[0];
  const pieces = local.split(/[._-]/).filter(Boolean);
  if (pieces.length >= 2) return (pieces[0][0] + pieces[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

interface AvatarProps {
  name?: string | null;
  email?: string | null;
  size?: number;
  ring?: boolean;
  square?: boolean;
  remote?: boolean;
}

export function Avatar({
  name,
  email,
  size = 44,
  ring = false,
  square = false,
  remote = true,
}: AvatarProps) {
  const palette = usePalette();
  const label = initials(name, email);
  const [photo, setPhoto] = useState<string | null>(null);
  const gradient = useMemo(() => {
    const gradients = palette.avatarGradients;
    return gradients[hash((email || name || "?").toLowerCase()) % gradients.length];
  }, [email, name, palette.avatarGradients]);

  useEffect(() => {
    let active = true;
    setPhoto(null);
    if (!remote || !email) return;
    loadAvatarUri(email)
      .then((uri) => {
        if (active && uri) setPhoto(uri);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [email, remote]);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: square ? size * 0.3 : size / 2,
          overflow: "hidden",
          borderWidth: ring ? 2 : 0,
          borderColor: palette.canvas,
          backgroundColor: palette.surfaceRaised,
        },
      ]}
    >
      <LinearGradient
        colors={[gradient[0], gradient[1]]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      >
        <View style={styles.center}>
          <AppText
            weight="bold"
            color="#FFFFFF"
            style={{
              fontSize: size * 0.34,
              letterSpacing: -0.3,
              lineHeight: size * 0.4,
            }}
          >
            {label}
          </AppText>
        </View>
      </LinearGradient>
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={[StyleSheet.absoluteFill, { width: size, height: size }]}
          resizeMode="cover"
          onError={() => setPhoto(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
