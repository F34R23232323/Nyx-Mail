import React, { useMemo, useState } from "react";
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useMailData } from "../../lib/mail-data";
import { apiFetch, ApiError } from "../../lib/api";
import { useCompose } from "../../compose/ComposeProvider";
import { displaySender, isEmail } from "../../lib/format";
import type { ContactDTO } from "../../lib/types";
import type { TabScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { IconButton } from "../../components/ui/IconButton";
import { Sheet } from "../../components/ui/Sheet";
import { TextField } from "../../components/ui/TextField";
import { Touchable } from "../../components/ui/Touchable";
import { useToast } from "../../components/ui/Toast";

type ContactSection = { title: string; data: ContactDTO[] };

export function ContactsScreen({ navigation }: TabScreenProps<"Contacts">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { contacts, refreshContacts } = useMailData();
  const { open: openCompose } = useCompose();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ContactDTO | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo<ContactSection[]>(() => {
    const needle = query.trim().toLowerCase();
    const filtered = contacts.filter(
      (contact) =>
        !needle ||
        contact.name.toLowerCase().includes(needle) ||
        contact.email.toLowerCase().includes(needle),
    );
    const grouped = new Map<string, ContactDTO[]>();
    for (const contact of filtered) {
      const key = (contact.name || contact.email).charAt(0).toUpperCase() || "#";
      const bucket = grouped.get(key) ?? [];
      bucket.push(contact);
      grouped.set(key, bucket);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, data]) => ({ title, data }));
  }, [contacts, query]);

  const total = contacts.length;

  const addContact = async () => {
    setError(null);
    if (!name.trim()) return setError("Add a name.");
    if (!isEmail(email)) return setError("Enter a valid email address.");
    setSaving(true);
    try {
      await apiFetch("/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase() }),
      });
      await refreshContacts();
      setAddOpen(false);
      setName("");
      setEmail("");
      toast({ title: "Contact saved", tone: "success" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Contact could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveContact = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/contacts/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName.trim() || selected.name }),
      });
      await refreshContacts();
      setSelected(null);
      toast({ title: "Contact updated", tone: "success" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Contact could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const deleteContact = () => {
    if (!selected) return;
    const target = selected;
    void confirm({
      title: "Delete contact?",
      description: `${target.name} will be removed from your address book.`,
      confirmLabel: "Delete contact",
      tone: "danger",
      icon: "user-x",
      details: [{ label: "Contact", value: target.name }],
      onConfirm: async () => {
        setSelected(null);
        try {
          await apiFetch(`/api/v1/contacts/${target.id}`, { method: "DELETE" });
          await refreshContacts();
          toast({ title: "Contact deleted", tone: "default" });
        } catch {
          toast({ title: "Contact could not be deleted", tone: "error" });
        }
      },
    });
  };

  const header = (
    <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.xl, gap: spacing.lg }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <AppText variant="display" weight="bold">
            People
          </AppText>
          <AppText variant="caption" color={palette.muted}>
            {total} contact{total === 1 ? "" : "s"} · collected from your mail
          </AppText>
        </View>
        <IconButton
          name="user-plus"
          variant="soft"
          size={40}
          iconSize={18}
          accessibilityLabel="Add contact"
          onPress={() => {
            setName("");
            setEmail("");
            setError(null);
            setAddOpen(true);
          }}
        />
      </View>
      <View
        style={[
          styles.searchBox,
          { backgroundColor: palette.surface, borderColor: query ? palette.accent : palette.border },
        ]}
      >
        <Feather name="search" size={16} color={query ? palette.accent : palette.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people"
          placeholderTextColor={palette.faint}
          selectionColor={palette.accent}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            flex: 1,
            color: palette.ink,
            fontFamily: "Inter_400Regular",
            fontSize: 15,
            paddingVertical: spacing.md,
          }}
        />
        {query ? (
          <Touchable onPress={() => setQuery("")} haptic="light" accessibilityLabel="Clear search">
            <Feather name="x-circle" size={16} color={palette.faint} />
          </Touchable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refreshContacts().catch(() => undefined);
              setRefreshing(false);
            }}
            tintColor={palette.accent}
            colors={[palette.accent]}
          />
        }
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        renderSectionHeader={({ section }) => (
          <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xs }}>
            <AppText variant="micro" color={palette.faint}>
              {section.title}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => (
          <View
            style={[
              styles.row,
              { backgroundColor: palette.surface, borderColor: palette.borderSoft },
            ]}
          >
            <Touchable
              onPress={() => {
                setSelected(item);
                setEditName(item.name);
                setError(null);
              }}
              haptic="light"
              style={styles.rowMain}
            >
              <Avatar name={item.name} email={item.email} size={42} />
              <View style={{ flex: 1 }}>
                <AppText variant="small" weight="semibold" numberOfLines={1}>
                  {item.name || displaySender(null, item.email)}
                </AppText>
                <AppText variant="caption" color={palette.faint} numberOfLines={1}>
                  {item.email}
                </AppText>
              </View>
            </Touchable>
            <IconButton
              name="edit-2"
              size={36}
              iconSize={16}
              color={palette.accent}
              accessibilityLabel={`Write to ${item.name || item.email}`}
              onPress={() =>
                openCompose({
                  mode: "new",
                  to: [{ email: item.email, name: item.name || undefined }],
                })
              }
            />
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title={query ? "No people found" : "No contacts yet"}
            description={
              query
                ? "Try a different name or address."
                : "Contacts are collected automatically when you send or receive mail. Add one manually to get started."
            }
            actionLabel="Add contact"
            onAction={() => setAddOpen(true)}
          />
        }
      />

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="New contact">
        <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
          <TextField
            label="Name"
            placeholder="Ada Lovelace"
            icon="user"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setError(null);
            }}
          />
          <TextField
            label="Email"
            placeholder="ada@example.com"
            icon="at-sign"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setError(null);
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
          />
          <Button label="Save contact" icon="check" size="lg" loading={saving} onPress={addContact} />
        </View>
      </Sheet>

      <Sheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name || "Contact"}
        description={selected?.email}
      >
        {selected ? (
          <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
            <View style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.md }}>
              <Avatar name={selected.name} email={selected.email} size={72} ring />
              <AppText variant="heading" weight="semibold">
                {selected.name || displaySender(null, selected.email)}
              </AppText>
              <Touchable
                onPress={async () => {
                  await Clipboard.setStringAsync(selected.email);
                  toast({ title: "Address copied", tone: "success" });
                }}
                haptic="light"
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <AppText variant="caption" color={palette.muted}>
                    {selected.email}
                  </AppText>
                  <Feather name="copy" size={11} color={palette.faint} />
                </View>
              </Touchable>
            </View>
            <TextField
              label="Display name"
              icon="user"
              value={editName}
              onChangeText={setEditName}
              error={error}
            />
            <Button
              label="New message"
              icon="edit-3"
              size="lg"
              onPress={() => {
                const contact = selected;
                setSelected(null);
                openCompose({
                  mode: "new",
                  to: [{ email: contact.email, name: contact.name || undefined }],
                });
              }}
            />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <Button
                label="Save changes"
                onPress={saveContact}
                loading={saving}
                variant="secondary"
                style={{ flex: 1 }}
              />
              <Button
                label="Delete"
                onPress={deleteContact}
                variant="danger"
                icon="trash-2"
                style={{ flex: 1 }}
                fullWidth={false}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  searchBox: {
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.lg,
    marginBottom: 6,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingRight: spacing.sm,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
});
