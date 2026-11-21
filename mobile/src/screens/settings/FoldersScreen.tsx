import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useMailData } from "../../lib/mail-data";
import { apiFetch, ApiError } from "../../lib/api";
import type { FolderDTO } from "../../lib/types";
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

function folderIcon(type: FolderDTO["type"]): keyof typeof Feather.glyphMap {
  switch (type) {
    case "INBOX":
      return "inbox";
    case "SENT":
      return "send";
    case "DRAFTS":
      return "file-text";
    case "ARCHIVE":
      return "archive";
    case "SPAM":
      return "slash";
    case "TRASH":
      return "trash-2";
    default:
      return "folder";
  }
}

export function FoldersScreen({ navigation }: RootScreenProps<"Folders">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { folders, refreshFolders, refreshUnread } = useMailData();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<FolderDTO | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const system = folders.filter((folder) => folder.type !== "CUSTOM");
  const custom = folders.filter((folder) => folder.type === "CUSTOM");

  const create = async () => {
    if (!name.trim()) return setError("Enter a folder name.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/v1/folders", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      await refreshFolders();
      setAddOpen(false);
      setName("");
      toast({ title: "Folder created", tone: "success" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Folder could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!selected) return;
    if (!name.trim()) return setError("Enter a folder name.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/folders/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      await refreshFolders();
      setSelected(null);
      toast({ title: "Folder renamed", tone: "success" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Folder could not be renamed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!selected) return;
    const target = selected;
    void confirm({
      title: "Delete folder?",
      description: "Messages in this folder will be moved to Archive. The folder itself is removed.",
      confirmLabel: "Delete folder",
      tone: "warning",
      icon: "trash-2",
      details: [{ label: "Folder", value: target.name }],
      onConfirm: async () => {
        setSelected(null);
        try {
          await apiFetch(`/api/v1/folders/${target.id}`, { method: "DELETE" });
          await Promise.all([refreshFolders(), refreshUnread()]);
          toast({ title: "Folder deleted", tone: "default" });
        } catch (caught) {
          toast({
            title: caught instanceof ApiError ? caught.message : "Folder could not be deleted",
            tone: "error",
          });
        }
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas, paddingTop: insets.top }}>
      <ScreenHeader
        title="Folders"
        subtitle="Organise mail with folders"
        onBack={() => navigation.goBack()}
        right={
          <IconButton
            name="folder-plus"
            variant="soft"
            size={38}
            accessibilityLabel="Add folder"
            onPress={() => {
              setName("");
              setError(null);
              setAddOpen(true);
            }}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: spacing.sm }}>
          <AppText variant="micro" color={palette.faint}>
            SYSTEM FOLDERS
          </AppText>
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            {system.map((folder, index) => (
              <View
                key={folder.id}
                style={[
                  styles.row,
                  index < system.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: palette.borderSoft,
                  },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: palette.surfaceRaised }]}>
                  <Feather name={folderIcon(folder.type)} size={16} color={palette.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="small" weight="medium">
                    {folder.name}
                  </AppText>
                  <AppText variant="caption" color={palette.faint}>
                    System folder
                  </AppText>
                </View>
                {folder.unreadCount ? (
                  <View style={[styles.count, { backgroundColor: palette.surfaceRaised }]}>
                    <AppText variant="micro" color={palette.muted} style={{ fontSize: 8.5 }}>
                      {folder.unreadCount}
                    </AppText>
                  </View>
                ) : null}
                <Feather name="lock" size={12} color={palette.faint} />
              </View>
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText variant="micro" color={palette.faint}>
              YOUR FOLDERS
            </AppText>
            <AppText variant="caption" color={palette.faint}>
              {custom.length} / 100
            </AppText>
          </View>
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            {custom.length === 0 ? (
              <EmptyState
                compact
                icon="folder-plus"
                title="No custom folders"
                description="Create folders for projects, clients or anything you want to keep separate."
                actionLabel="Create folder"
                onAction={() => setAddOpen(true)}
              />
            ) : (
              custom.map((folder, index) => (
                <Touchable
                  key={folder.id}
                  onPress={() => {
                    setSelected(folder);
                    setName(folder.name);
                    setError(null);
                  }}
                  haptic="light"
                  style={[
                    styles.row,
                    index < custom.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: palette.borderSoft,
                    },
                  ]}
                >
                  <View style={[styles.icon, { backgroundColor: palette.accentSoft }]}>
                    <Feather name="folder" size={16} color={palette.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="small" weight="medium">
                      {folder.name}
                    </AppText>
                    <AppText variant="caption" color={palette.faint}>
                      Custom folder
                    </AppText>
                  </View>
                  {folder.unreadCount ? (
                    <View style={[styles.count, { backgroundColor: palette.accentSoft }]}>
                      <AppText variant="micro" color={palette.accentStrong} style={{ fontSize: 8.5 }}>
                        {folder.unreadCount}
                      </AppText>
                    </View>
                  ) : null}
                  <Feather name="chevron-right" size={15} color={palette.faint} />
                </Touchable>
              ))
            )}
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
          <Feather name="info" size={13} color={palette.faint} style={{ marginTop: 2 }} />
          <AppText variant="caption" color={palette.faint} style={{ flex: 1, lineHeight: 18 }}>
            System folders cannot be renamed or deleted. Deleting a custom folder moves its messages to
            Archive.
          </AppText>
        </View>
      </ScrollView>

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="New folder">
        <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
          <TextField
            label="Folder name"
            placeholder="Projects"
            icon="folder"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setError(null);
            }}
            maxLength={50}
            error={error}
            autoFocus
          />
          <Button label="Create folder" icon="plus" size="lg" loading={busy} onPress={create} />
        </View>
      </Sheet>

      <Sheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? "Folder"}
        description="Rename or delete this folder."
      >
        {selected ? (
          <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
            <TextField
              label="Folder name"
              icon="folder"
              value={name}
              onChangeText={(value) => {
                setName(value);
                setError(null);
              }}
              maxLength={50}
              error={error}
              autoFocus
            />
            <Button label="Save changes" icon="check" size="lg" loading={busy} onPress={rename} />
            <Button label="Delete folder" icon="trash-2" variant="danger" onPress={remove} />
          </View>
        ) : null}
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
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  count: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
});
