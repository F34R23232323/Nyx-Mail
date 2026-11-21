import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useMailData } from "../../lib/mail-data";
import { apiFetch, ApiError } from "../../lib/api";
import type { LabelDTO } from "../../lib/types";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState, ScreenHeader } from "../../components/ui/EmptyState";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { IconButton } from "../../components/ui/IconButton";
import { Sheet } from "../../components/ui/Sheet";
import { TextField } from "../../components/ui/TextField";
import { Touchable } from "../../components/ui/Touchable";
import { useToast } from "../../components/ui/Toast";

const COLORS = [
  "#8B5CF6",
  "#FF5E8E",
  "#3FE0C5",
  "#F2B95C",
  "#5CB8FF",
  "#C084FC",
  "#6EE7A8",
  "#FF8A65",
  "#94A3B8",
  "#F472B6",
];

export function LabelsScreen({ navigation }: RootScreenProps<"Labels">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { labels, refreshLabels } = useMailData();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<LabelDTO | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setSelected(null);
    setName("");
    setColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
    setError(null);
    setOpen(true);
  };

  const openEdit = (label: LabelDTO) => {
    setSelected(label);
    setName(label.name);
    setColor(label.color);
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return setError("Enter a label name.");
    setBusy(true);
    setError(null);
    try {
      if (selected) {
        await apiFetch(`/api/v1/labels/${selected.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), color }),
        });
      } else {
        await apiFetch("/api/v1/labels", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), color }),
        });
      }
      await refreshLabels();
      setOpen(false);
      toast({ title: selected ? "Label updated" : "Label created", tone: "success" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Label could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!selected) return;
    const target = selected;
    void confirm({
      title: "Delete label?",
      description: `“${target.name}” will be removed from every conversation. Messages are not deleted.`,
      confirmLabel: "Delete label",
      tone: "warning",
      icon: "tag",
      details: [{ label: "Label", value: target.name }],
      onConfirm: async () => {
        setOpen(false);
        try {
          await apiFetch(`/api/v1/labels/${target.id}`, { method: "DELETE" });
          await refreshLabels();
          toast({ title: "Label deleted", tone: "default" });
        } catch (caught) {
          toast({
            title: caught instanceof ApiError ? caught.message : "Label could not be deleted",
            tone: "error",
          });
        }
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
      <ScreenHeader
        title="Labels"
        subtitle="Colour-code conversations across folders"
        onBack={() => navigation.goBack()}
        right={
          <IconButton
            name="plus"
            variant="soft"
            size={38}
            accessibilityLabel="Create label"
            onPress={openCreate}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {labels.length === 0 ? (
            <EmptyState
              compact
              icon="tag"
              title="No labels yet"
              description="Labels let you group conversations without moving them out of their folder."
              actionLabel="Create label"
              onAction={openCreate}
            />
          ) : (
            labels.map((label, index) => (
              <Touchable
                key={label.id}
                onPress={() => openEdit(label)}
                haptic="light"
                style={[
                  styles.row,
                  index < labels.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: palette.borderSoft,
                  },
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: `${label.color}25` }]}>
                  <View style={[styles.dot, { backgroundColor: label.color }]} />
                </View>
                <AppText variant="small" weight="medium" style={{ flex: 1 }}>
                  {label.name}
                </AppText>
                <View style={[styles.colorBar, { backgroundColor: label.color }]} />
                <Feather name="chevron-right" size={15} color={palette.faint} />
              </Touchable>
            ))
          )}
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
          <Feather name="info" size={13} color={palette.faint} style={{ marginTop: 2 }} />
          <AppText variant="caption" color={palette.faint} style={{ flex: 1, lineHeight: 18 }}>
            Labels are encrypted metadata inside each message and remain available in every folder.
          </AppText>
        </View>
      </ScrollView>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={selected ? "Edit label" : "New label"}
        description="Choose a name and a colour."
      >
        <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
          <TextField
            label="Label name"
            placeholder="Receipts"
            icon="tag"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setError(null);
            }}
            maxLength={50}
            error={error}
            autoFocus={!selected}
          />
          <View style={{ gap: spacing.sm }}>
            <AppText variant="label" color={palette.muted}>
              Colour
            </AppText>
            <View style={styles.swatches}>
              {COLORS.map((swatch) => (
                <Touchable
                  key={swatch}
                  onPress={() => setColor(swatch)}
                  haptic="light"
                  accessibilityLabel={`Use colour ${swatch}`}
                  style={[
                    styles.colorOption,
                    {
                      backgroundColor: swatch,
                      borderColor: color === swatch ? palette.ink : "transparent",
                      borderWidth: color === swatch ? 2 : 0,
                    },
                  ]}
                >
                  {color === swatch ? <Feather name="check" size={13} color="#FFFFFF" /> : null}
                </Touchable>
              ))}
            </View>
          </View>
          <Button
            label={selected ? "Save changes" : "Create label"}
            icon="check"
            size="lg"
            loading={busy}
            onPress={save}
          />
          {selected ? (
            <Button label="Delete label" icon="trash-2" variant="danger" onPress={remove} />
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 58,
  },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  colorBar: { width: 3, height: 20, borderRadius: 2 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
