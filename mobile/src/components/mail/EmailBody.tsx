import React, { useMemo, useState } from "react";
import { Linking, StyleSheet, View, useWindowDimensions } from "react-native";
import RenderHTML, { defaultSystemFonts } from "react-native-render-html";
import Feather from "@expo/vector-icons/Feather";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { pluralize } from "../../lib/format";
import { AppText } from "../ui/AppText";
import { Touchable } from "../ui/Touchable";

function stripUnsafeHtml(html: string, allowRemoteImages: boolean): string {
  let output = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<(iframe|object|embed|form|input|button|textarea|select|base|link|meta|svg|math|video|audio|source)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(iframe|object|embed|form|input|button|textarea|select|base|link|meta|svg|math|video|audio|source)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s(srcset|formaction|action|ping|http-equiv)\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/javascript:/gi, "");
  if (!allowRemoteImages) {
    output = output.replace(/<img\b[^>]*?>/gi, (tag) => {
      const src = /src\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
      const value = src?.[2] ?? src?.[3] ?? "";
      return /^https?:/i.test(value) ? "" : tag;
    });
  }
  return output;
}

export function countRemoteImages(html: string): number {
  const matches = html.match(/<img\b[^>]*src\s*=\s*("|')?https?:/gi);
  return matches?.length ?? 0;
}

function EmailBodyComponent({ html, text }: { html: string; text: string }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const [allowImages, setAllowImages] = useState(false);
  const remoteImages = useMemo(() => countRemoteImages(html), [html]);
  const sanitized = useMemo(() => stripUnsafeHtml(html, allowImages), [allowImages, html]);
  const contentWidth = width - spacing.xl * 2 - spacing.lg * 2;

  const tagsStyles = useMemo(
    () => ({
      body: {
        color: palette.inkSoft,
        fontSize: 14.5,
        lineHeight: 23,
        fontFamily: "Inter_400Regular",
      },
      p: { marginTop: 0, marginBottom: 10 },
      a: { color: palette.accentStrong, textDecorationLine: "underline" as const },
      b: { fontFamily: "Inter_600SemiBold" },
      strong: { fontFamily: "Inter_600SemiBold", color: palette.ink },
      i: { fontStyle: "italic" as const },
      em: { fontStyle: "italic" as const },
      u: { textDecorationLine: "underline" as const },
      h1: { fontSize: 24, fontFamily: "Inter_700Bold", color: palette.ink, marginBottom: 8 },
      h2: { fontSize: 20, fontFamily: "Inter_700Bold", color: palette.ink, marginBottom: 8 },
      h3: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: palette.ink, marginBottom: 6 },
      h4: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: palette.ink, marginBottom: 6 },
      blockquote: {
        borderLeftWidth: 2,
        borderLeftColor: palette.accentSoft,
        paddingLeft: 10,
        marginLeft: 0,
        marginVertical: 8,
        color: palette.muted,
      },
      pre: {
        backgroundColor: palette.surfaceRaised,
        color: palette.inkSoft,
        padding: 10,
        borderRadius: 8,
        fontFamily: "monospace",
        fontSize: 12.5,
      },
      code: {
        backgroundColor: palette.surfaceRaised,
        color: palette.inkSoft,
        fontSize: 12.5,
        fontFamily: "monospace",
      },
      ul: { marginVertical: 4 },
      ol: { marginVertical: 4 },
      li: { marginBottom: 3 },
      hr: { backgroundColor: palette.border, height: StyleSheet.hairlineWidth },
      img: { borderRadius: 8 },
      table: { borderColor: palette.border },
      td: { borderColor: palette.border, padding: 4 },
      th: { borderColor: palette.border, padding: 4 },
      small: { fontSize: 11, color: palette.faint },
    }),
    [palette],
  );

  if (!sanitized.trim()) {
    return (
      <AppText variant="small" color={palette.muted} style={{ lineHeight: 22 }}>
        {text || "This message has no visible content."}
      </AppText>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {remoteImages > 0 && !allowImages ? (
        <Touchable
          onPress={() => setAllowImages(true)}
          haptic="light"
          style={[
            styles.imageBanner,
            { backgroundColor: palette.warningSoft, borderColor: "rgba(242,185,92,0.2)" },
          ]}
        >
          <Feather name="image" size={13} color={palette.warning} />
          <AppText variant="caption" color={palette.warning} style={{ flex: 1 }}>
            {pluralize(remoteImages, "remote image")} blocked for privacy
          </AppText>
          <AppText variant="caption" weight="semibold" color={palette.warning}>
            Load
          </AppText>
        </Touchable>
      ) : null}
      <RenderHTML
        contentWidth={contentWidth}
        source={{ html: sanitized }}
        systemFonts={defaultSystemFonts}
        tagsStyles={tagsStyles}
        baseStyle={{ color: palette.inkSoft }}
        enableExperimentalMarginCollapsing
        renderersProps={{
          a: {
            onPress: (_event, href) => {
              if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
                Linking.openURL(href).catch(() => undefined);
              }
            },
          },
        }}
      />
    </View>
  );
}

export const EmailBody = React.memo(EmailBodyComponent);

const styles = StyleSheet.create({
  imageBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
