import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import Feather from "@expo/vector-icons/Feather";
import { LinearGradient } from "expo-linear-gradient";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { useMailData } from "../../lib/mail-data";
import { apiFetch, ApiError, downloadAttachment } from "../../lib/api";
import {
  encryptAttachmentBytes,
  decryptAttachmentBytes,
  type ClientAttachmentMeta,
} from "../../lib/crypto";
import {
  addressesFromMail,
  preferredSender,
  quoteForward,
  quoteReply,
  replySubject,
  sealCompose,
  sealDraft,
  signatureHtml,
  uploadAttachmentFromUri,
} from "../../lib/mail";
import { emitMailEvent } from "../../lib/mailBus";
import { connectGmailForSending } from "../../lib/gmail";
import { formatBytes, htmlToText, isEmail, textToHtml } from "../../lib/format";
import type { ContactDTO, GmailAccountDTO } from "../../lib/types";
import type { ComposeSeed } from "../../compose/ComposeProvider";
import { AppText } from "../../components/ui/AppText";
import { Avatar } from "../../components/ui/Avatar";
import { IconButton } from "../../components/ui/IconButton";
import { Sheet } from "../../components/ui/Sheet";
import { Touchable } from "../../components/ui/Touchable";
import { useToast } from "../../components/ui/Toast";

interface Recipient {
  email: string;
  name?: string;
}

interface ComposeState {
  fromAddress: string;
  gmailAccountId: string | null;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  body: string;
  attachments: ClientAttachmentMeta[];
}

function modeTitle(mode: ComposeSeed["mode"]): string {
  switch (mode) {
    case "reply":
      return "Reply";
    case "replyAll":
      return "Reply all";
    case "forward":
      return "Forward";
    case "draft":
      return "Draft";
    default:
      return "New message";
  }
}

function gmailIdFor(address: string, accounts: GmailAccountDTO[]): string | null {
  const normalized = address.trim().toLowerCase();
  return accounts.find((account) => account.googleEmail.toLowerCase() === normalized)?.id ?? null;
}

function buildInitial(
  seed: ComposeSeed,
  own: string,
  source: ComposeSeed["source"],
  gmailAccounts: GmailAccountDTO[],
): ComposeState {
  const base: ComposeState = {
    fromAddress: own,
    gmailAccountId: gmailIdFor(own, gmailAccounts),
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    body: "",
    attachments: [],
  };
  if (!source) {
    return {
      ...base,
      subject: seed.subject ?? "",
      to: seed.to ? seed.to.map((address) => ({ email: address.email, name: address.name })) : [],
    };
  }
  if (seed.mode === "draft") {
    return {
      fromAddress: source.dto.fromAddress || own,
      gmailAccountId: gmailIdFor(source.dto.fromAddress || own, gmailAccounts),
      to: source.dto.toAddresses.map((address) => ({ email: address.email, name: address.name })),
      cc: source.dto.ccAddresses.map((address) => ({ email: address.email, name: address.name })),
      bcc: source.dto.bccAddresses.map((address) => ({ email: address.email, name: address.name })),
      subject: source.subject,
      body: source.body.text || htmlToText(source.body.html),
      attachments: source.body.attachments,
    };
  }
  if (seed.mode === "forward") {
    return {
      ...base,
      subject: replySubject(source.subject, "forward"),
    };
  }
  const others = [...source.dto.toAddresses, ...source.dto.ccAddresses].filter(
    (address) => address.email.toLowerCase() !== own.toLowerCase(),
  );
  return {
    ...base,
    to: [{ email: source.dto.fromAddress, name: source.dto.fromName ?? undefined }],
    cc:
      seed.mode === "replyAll"
        ? others
            .filter((address) => address.email.toLowerCase() !== source.dto.fromAddress.toLowerCase())
            .map((address) => ({ email: address.email, name: address.name }))
        : [],
    subject: replySubject(source.subject, seed.mode === "replyAll" ? "replyAll" : "reply"),
  };
}

function uniqueRecipients(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return list.filter((recipient) => {
    const key = recipient.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ComposeScreen({ seed, onClose }: { seed: ComposeSeed; onClose: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { user, keys } = useAuth();
  const {
    aliases,
    contacts,
    gmailAccounts,
    refreshGmailAccounts,
    refreshUnread,
    refreshFolders,
  } = useMailData();
  const { toast } = useToast();

  const gmailAddresses = useMemo(
    () => gmailAccounts.filter((account) => account.enabled).map((account) => account.googleEmail),
    [gmailAccounts],
  );
  const ownAddress = useMemo(
    () => (user ? preferredSender(user.email, aliases, gmailAddresses) : ""),
    [aliases, gmailAddresses, user],
  );
  const initial = useMemo(
    () => buildInitial(seed, ownAddress, seed.source, gmailAccounts),
    [gmailAccounts, ownAddress, seed],
  );

  const [state, setState] = useState<ComposeState>(initial);
  const [showCc, setShowCc] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [forwarding, setForwarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(
    seed.mode === "draft" ? seed.source?.dto.id ?? null : null,
  );
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved">("idle");
  const [fromOpen, setFromOpen] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<Date | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const sendingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  const forwardStarted = useRef(false);

  const update = useCallback((patch: Partial<ComposeState>) => {
    dirtyRef.current = true;
    setDraftState("idle");
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const directAddresses = useMemo(
    () => Array.from(new Set([user?.email ?? "", ...aliases.map((alias) => alias.address)].filter(Boolean))),
    [aliases, user?.email],
  );
  const ownAddresses = useMemo(
    () => Array.from(new Set([...directAddresses, ...gmailAddresses])),
    [directAddresses, gmailAddresses],
  );
  const fromIsGmail = gmailAddresses.some(
    (address) => address.toLowerCase() === state.fromAddress.toLowerCase(),
  );

  const signature = useMemo(
    () =>
      user
        ? signatureHtml({
            displayName: user.displayName,
            email: user.email,
            signatureText: user.signatureText,
            signatureHtml: user.signatureHtml,
          })
        : "",
    [user],
  );

  const quote = useMemo(() => {
    if (!seed.source) return "";
    if (seed.mode === "reply" || seed.mode === "replyAll") return quoteReply(seed.source);
    if (seed.mode === "forward") return quoteForward(seed.source);
    return "";
  }, [seed]);

  const plainQuote = useMemo(() => (quote ? htmlToText(quote) : ""), [quote]);

  const buildPayload = useCallback(() => {
    const bodyHtml = textToHtml(state.body.trim());
    const fullHtml = `${bodyHtml}${signature}${quote}`;
    const signatureText = user?.signatureText ? `\n\n--\n${user.signatureText}` : "";
    const fullText = `${state.body.trim()}${signatureText}${
      plainQuote ? `\n\n${plainQuote}` : ""
    }`.trim();
    return { html: fullHtml, text: fullText };
  }, [plainQuote, quote, signature, state.body, user?.signatureText]);

  const saveDraft = useCallback(
    async (silent: boolean): Promise<string | null> => {
      if (!keys || !user || sendingRef.current || savingRef.current) return draftIdRef.current;
      const current = stateRef.current;
      const hasContent =
        current.subject.trim() ||
        current.body.trim() ||
        current.to.length ||
        current.cc.length ||
        current.bcc.length ||
        current.attachments.length;
      if (!hasContent) return draftIdRef.current;
      savingRef.current = true;
      setDraftState("saving");
      try {
        const payload = buildPayload();
        const sealed = await sealDraft({
          subject: current.subject,
          html: payload.html,
          text: payload.text,
          attachments: current.attachments,
          bundle: keys,
          accountEmail: user.email,
        });
        const result = await apiFetch<{ draftId: string }>("/api/v1/messages/draft", {
          method: "POST",
          body: JSON.stringify({
            id: draftIdRef.current,
            fromAddress: current.fromAddress,
            to: current.to,
            cc: current.cc,
            bcc: current.bcc,
            sealed,
            attachments: current.attachments.map((attachment) => ({
              blobId: attachment.blobId,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              contentId: attachment.contentId ?? null,
              inline: Boolean(attachment.inline),
            })),
            threadId: seed.source?.dto.threadId ?? seed.threadId ?? null,
            inReplyTo: seed.source?.dto.messageIdHeader ?? null,
            references: seed.source
              ? Array.from(
                  new Set(
                    [...seed.source.dto.references, seed.source.dto.messageIdHeader].filter(
                      (value): value is string => Boolean(value),
                    ),
                  ),
                )
              : [],
          }),
        });
        draftIdRef.current = result.draftId;
        setDraftId(result.draftId);
        dirtyRef.current = false;
        setDraftState("saved");
        emitMailEvent({ type: "draft-saved" });
        return result.draftId;
      } catch (caught) {
        setDraftState("idle");
        if (!silent) {
          setError(caught instanceof ApiError ? caught.message : "Draft could not be saved.");
        }
        return draftIdRef.current;
      } finally {
        savingRef.current = false;
      }
    },
    [buildPayload, keys, seed.source, seed.threadId, user],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current && !sendingRef.current && !savingRef.current) {
        void saveDraft(true);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [saveDraft]);

  useEffect(() => {
    if (seed.mode !== "forward" || !seed.source || forwardStarted.current) return;
    forwardStarted.current = true;
    const sourceAttachments = seed.source.body.attachments;
    if (!sourceAttachments.length) return;
    setForwarding(true);
    (async () => {
      for (const attachment of sourceAttachments) {
        try {
          const encrypted = await downloadAttachment(attachment.blobId);
          const plain = decryptAttachmentBytes(encrypted, attachment.key);
          const reencrypted = encryptAttachmentBytes(plain);
          const { uploadEncryptedAttachment } = await import("../../lib/api");
          const uploaded = await uploadEncryptedAttachment({
            ciphertext: reencrypted.ciphertext,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          });
          setState((current) => ({
            ...current,
            attachments: [
              ...current.attachments,
              {
                ...attachment,
                id: uploaded.attachment.blobId,
                blobId: uploaded.attachment.blobId,
                key: reencrypted.key,
                contentId: null,
                inline: false,
              },
            ],
          }));
          dirtyRef.current = true;
        } catch {
          toast({ title: `Could not forward ${attachment.filename}`, tone: "error" });
        }
      }
      setForwarding(false);
    })();
  }, [seed, toast]);

  const addFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    for (const asset of result.assets) {
      if ((asset.size ?? 0) > 25 * 1024 * 1024) {
        toast({ title: `${asset.name} is over 25MB`, tone: "error" });
        continue;
      }
      setUploading((value) => value + 1);
      try {
        const attachment = await uploadAttachmentFromUri({
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType || "application/octet-stream",
          size: asset.size ?? 0,
        });
        setState((current) => ({
          ...current,
          attachments: [...current.attachments, attachment],
        }));
        dirtyRef.current = true;
      } catch (caught) {
        toast({
          title: "Attachment could not be encrypted",
          description: caught instanceof Error ? caught.message : undefined,
          tone: "error",
        });
      } finally {
        setUploading((value) => Math.max(0, value - 1));
      }
    }
  };

  const recipients = uniqueRecipients([...state.to, ...state.cc, ...state.bcc]);

  const send = async () => {
    if (!keys || !user || sendingRef.current || busy) return;
    if (!state.to.length) return setError("Add at least one recipient.");
    if (recipients.some((recipient) => !isEmail(recipient.email))) {
      return setError("One of the recipients is not a valid email address.");
    }
    if (uploading > 0 || forwarding) return setError("Wait for attachments to finish.");
    setError(null);
    setBusy(true);
    try {
      if (dirtyRef.current) await saveDraft(true);
      sendingRef.current = true;
      const payload = buildPayload();
      const { sealed, externalAddresses } = await sealCompose({
        subject: state.subject,
        html: payload.html,
        text: payload.text,
        attachments: state.attachments,
        fromAddress: state.fromAddress,
        accountEmail: user.email,
        recipientAddresses: recipients.map((recipient) => recipient.email),
        bundle: keys,
      });
      const response = await apiFetch<{
        scheduled?: boolean;
        externalRecipients?: number;
        deliveredInternally?: number;
        warnings?: string[];
      }>("/api/v1/messages/send", {
        method: "POST",
        body: JSON.stringify({
          fromAddress: state.fromAddress,
          gmailAccountId: state.gmailAccountId,
          to: state.to,
          cc: state.cc,
          bcc: state.bcc,
          sealed,
          draftId: draftIdRef.current,
          threadId: seed.source?.dto.threadId ?? seed.threadId ?? null,
          inReplyTo: seed.source?.dto.messageIdHeader ?? null,
          references: seed.source
            ? Array.from(
                new Set(
                  [...seed.source.dto.references, seed.source.dto.messageIdHeader].filter(
                    (value): value is string => Boolean(value),
                  ),
                ),
              )
            : [],
          scheduledFor: scheduleAt ? scheduleAt.toISOString() : null,
          relay:
            externalAddresses.length > 0
              ? {
                  subject: state.subject || "(no subject)",
                  html: payload.html,
                  text: payload.text,
                  attachmentKeys: Object.fromEntries(
                    state.attachments.map((attachment) => [attachment.blobId, attachment.key]),
                  ),
                }
              : null,
          attachments: state.attachments.map((attachment) => ({
            blobId: attachment.blobId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            contentId: attachment.contentId ?? null,
            inline: Boolean(attachment.inline),
          })),
        }),
        timeoutMs: 120_000,
      });
      dirtyRef.current = false;
      toast({
        title: response.scheduled ? "Message scheduled" : "Message sent",
        description: response.scheduled
          ? scheduleAt?.toLocaleString()
          : response.externalRecipients
            ? `Delivered to ${response.externalRecipients} external recipient${
                response.externalRecipients === 1 ? "" : "s"
              }.`
            : "Delivered with end-to-end encryption.",
        tone: "success",
      });
      emitMailEvent({ type: "sent" });
      refreshUnread().catch(() => undefined);
      refreshFolders().catch(() => undefined);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your message could not be sent.");
    } finally {
      setBusy(false);
      sendingRef.current = false;
    }
  };

  const requestClose = async () => {
    if (sendingRef.current) return;
    if (dirtyRef.current) {
      if (uploading > 0 || forwarding) {
        Alert.alert("Attachments are still uploading", "Keep this message open until the upload finishes.");
        return;
      }
      await saveDraft(true);
      if (!dirtyRef.current) {
        toast({ title: "Draft saved", tone: "default" });
      }
    }
    onClose();
  };

  useEffect(() => {
    if (!fromOpen) return;
    refreshGmailAccounts().catch((caught) => {
      toast({
        title: "Could not load Gmail identities",
        description:
          caught instanceof ApiError || caught instanceof Error ? caught.message : undefined,
        tone: "error",
      });
    });
  }, [fromOpen, refreshGmailAccounts, toast]);

  const connectGmail = async () => {
    if (gmailConnecting) return;
    setGmailConnecting(true);
    try {
      const result = await connectGmailForSending();
      if (!result) return;
      await refreshGmailAccounts();
      const fresh = await apiFetch<{
        accounts: { id: string; googleEmail: string; enabled: boolean }[];
      }>("/api/v1/imports/gmail/accounts")
        .then((data) => data.accounts)
        .catch(() => []);
      const account = fresh.find(
        (item) => item.googleEmail.toLowerCase() === (result.email ?? "").toLowerCase(),
      );
      if (account) {
        update({ fromAddress: account.googleEmail, gmailAccountId: account.id });
      }
      toast({
        title: "Gmail connected",
        description: result.email ?? "You can now send from this Gmail address.",
        tone: "success",
      });
    } catch (caught) {
      toast({
        title: "Gmail connection failed",
        description: caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setGmailConnecting(false);
    }
  };

  const scheduleOptions = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    const nextMonday = new Date();
    const days = (8 - nextMonday.getDay()) % 7 || 7;
    nextMonday.setDate(nextMonday.getDate() + days);
    nextMonday.setHours(8, 0, 0, 0);
    const inHour = new Date(Date.now() + 60 * 60 * 1000);
    return [
      { label: "Send now", value: null as Date | null, hint: "Deliver immediately" },
      { label: "In 1 hour", value: inHour, hint: inHour.toLocaleString() },
      { label: "Tomorrow morning", value: tomorrow, hint: tomorrow.toLocaleString() },
      { label: "Next Monday", value: nextMonday, hint: nextMonday.toLocaleString() },
    ];
  }, []);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={requestClose}>
      <View style={{ flex: 1, backgroundColor: palette.canvas }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <View
            style={[
              styles.header,
              {
                paddingTop: insets.top + spacing.sm,
                borderBottomColor: palette.borderSoft,
                backgroundColor: palette.canvas,
              },
            ]}
          >
            <IconButton
              name="x"
              onPress={requestClose}
              accessibilityLabel="Close composer"
              size={38}
            />
            <View style={{ flex: 1 }}>
              <AppText variant="heading" weight="semibold">
                {modeTitle(seed.mode)}
              </AppText>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Feather name="lock" size={9} color={palette.mint} />
                <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                  End-to-end encrypted
                </AppText>
              </View>
            </View>
            <Touchable
              onPress={send}
              disabled={busy || uploading > 0 || forwarding}
              haptic="success"
              accessibilityLabel={scheduleAt ? "Schedule message" : "Send message"}
              style={{ borderRadius: radius.pill, overflow: "hidden", opacity: busy ? 0.6 : 1 }}
            >
              <LinearGradient
                colors={[palette.gradient[0], palette.gradient[1]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sendButton}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name={scheduleAt ? "clock" : "send"} size={14} color="#FFFFFF" />
                    <AppText variant="caption" weight="semibold" color="#FFFFFF">
                      {scheduleAt ? "Schedule" : "Send"}
                    </AppText>
                  </>
                )}
              </LinearGradient>
            </Touchable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingBottom: insets.bottom + spacing.xxxl,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {scheduleAt ? (
              <View style={[styles.scheduleBanner, { backgroundColor: palette.accentSoft }]}>
                <Feather name="clock" size={13} color={palette.accent} />
                <AppText variant="caption" color={palette.accentStrong} style={{ flex: 1 }}>
                  Scheduled for {scheduleAt.toLocaleString()}
                </AppText>
                <Touchable onPress={() => setScheduleAt(null)} haptic="light">
                  <Feather name="x" size={14} color={palette.accentStrong} />
                </Touchable>
              </View>
            ) : null}

            <View style={styles.meta}>
              <Touchable
                onPress={() => setFromOpen(true)}
                haptic="light"
                style={[styles.fromRow, { borderBottomColor: palette.borderSoft }]}
              >
                <AppText variant="caption" color={palette.faint} style={{ width: 46 }}>
                  From
                </AppText>
                <View style={styles.fromInner}>
                  <Avatar name={user?.displayName} email={state.fromAddress} size={24} />
                  <AppText variant="small" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                    {state.fromAddress}
                    {fromIsGmail ? " · Gmail" : ""}
                  </AppText>
                  <Feather name="chevron-down" size={14} color={palette.faint} />
                </View>
              </Touchable>

              <AddressField
                label="To"
                value={state.to}
                onChange={(to) => update({ to })}
                suggestions={contacts}
                exclude={ownAddresses}
              />
              {showCc ? (
                <>
                  <AddressField
                    label="Cc"
                    value={state.cc}
                    onChange={(cc) => update({ cc })}
                    suggestions={contacts}
                    exclude={ownAddresses}
                  />
                  <AddressField
                    label="Bcc"
                    value={state.bcc}
                    onChange={(bcc) => update({ bcc })}
                    suggestions={contacts}
                    exclude={ownAddresses}
                  />
                </>
              ) : (
                <Touchable
                  onPress={() => setShowCc(true)}
                  haptic="light"
                  style={[styles.ccRow, { borderBottomColor: palette.borderSoft }]}
                >
                  <AppText variant="caption" color={palette.accentStrong} weight="medium">
                    Add Cc / Bcc
                  </AppText>
                </Touchable>
              )}

              <View style={[styles.subjectRow, { borderBottomColor: palette.borderSoft }]}>
                <TextInput
                  value={state.subject}
                  onChangeText={(subject) => update({ subject })}
                  placeholder="Subject"
                  placeholderTextColor={palette.faint}
                  selectionColor={palette.accent}
                  style={{
                    color: palette.ink,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 17,
                    paddingVertical: spacing.lg,
                  }}
                />
              </View>
            </View>

            <TextInput
              value={state.body}
              onChangeText={(body) => update({ body })}
              placeholder={seed.mode === "forward" ? "Add a note…" : "Write your message…"}
              placeholderTextColor={palette.faint}
              selectionColor={palette.accent}
              multiline
              textAlignVertical="top"
              style={[
                styles.body,
                {
                  color: palette.ink,
                  fontFamily: "Inter_400Regular",
                  minHeight: 220,
                },
              ]}
            />

            {quote ? (
              <View style={[styles.quoteBox, { borderLeftColor: palette.borderStrong }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Feather name="corner-down-right" size={11} color={palette.faint} />
                  <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                    Quoted message included on send
                  </AppText>
                </View>
                <AppText variant="caption" color={palette.muted} numberOfLines={3} style={{ lineHeight: 18 }}>
                  {plainQuote}
                </AppText>
              </View>
            ) : null}

            {state.attachments.length > 0 || uploading > 0 || forwarding ? (
              <View style={styles.attachments}>
                {state.attachments.map((attachment) => (
                  <View
                    key={attachment.blobId}
                    style={[
                      styles.attachment,
                      { backgroundColor: palette.surface, borderColor: palette.border },
                    ]}
                  >
                    <View style={[styles.fileIcon, { backgroundColor: palette.accentSoft }]}>
                      <Feather name="file" size={14} color={palette.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText variant="caption" weight="medium" numberOfLines={1}>
                        {attachment.filename}
                      </AppText>
                      <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                        {formatBytes(attachment.sizeBytes)} · encrypted
                      </AppText>
                    </View>
                    <Touchable
                      onPress={() =>
                        update({
                          attachments: state.attachments.filter(
                            (item) => item.blobId !== attachment.blobId,
                          ),
                        })
                      }
                      haptic="light"
                      accessibilityLabel={`Remove ${attachment.filename}`}
                    >
                      <Feather name="x" size={15} color={palette.faint} />
                    </Touchable>
                  </View>
                ))}
                {uploading > 0 ? (
                  <View style={styles.uploadingRow}>
                    <ActivityIndicator size="small" color={palette.accent} />
                    <AppText variant="caption" color={palette.muted}>
                      Encrypting {uploading} attachment{uploading === 1 ? "" : "s"}…
                    </AppText>
                  </View>
                ) : null}
                {forwarding ? (
                  <View style={styles.uploadingRow}>
                    <ActivityIndicator size="small" color={palette.accent} />
                    <AppText variant="caption" color={palette.muted}>
                      Copying forwarded attachments…
                    </AppText>
                  </View>
                ) : null}
              </View>
            ) : null}

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft }]}>
                <Feather name="alert-circle" size={15} color={palette.danger} />
                <AppText variant="caption" color={palette.danger} style={{ flex: 1 }}>
                  {error}
                </AppText>
              </View>
            ) : null}
          </ScrollView>

          <View
            style={[
              styles.toolbar,
              {
                borderTopColor: palette.borderSoft,
                backgroundColor: palette.canvasRaised,
                paddingBottom: Math.max(insets.bottom, spacing.md),
              },
            ]}
          >
            <Touchable
              onPress={addFiles}
              haptic="light"
              style={[styles.toolButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
              accessibilityLabel="Attach a file"
            >
              <Feather name="paperclip" size={17} color={palette.inkSoft} />
            </Touchable>
            <Touchable
              onPress={() => setScheduleOpen(true)}
              haptic="light"
              style={[styles.toolButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
              accessibilityLabel="Schedule send"
            >
              <Feather name="clock" size={17} color={palette.inkSoft} />
            </Touchable>
            <View style={{ flex: 1 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              {draftState === "saving" ? (
                <ActivityIndicator size="small" color={palette.faint} />
              ) : (
                <Feather
                  name={draftState === "saved" ? "check" : "edit-3"}
                  size={11}
                  color={palette.faint}
                />
              )}
              <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                {draftState === "saving"
                  ? "Saving draft"
                  : draftState === "saved"
                    ? "Draft saved"
                    : "Autosaves encrypted"}
              </AppText>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      <Sheet
        visible={fromOpen}
        onClose={() => setFromOpen(false)}
        title="Send from"
        description="NyxMail addresses stay end-to-end encrypted. Gmail identities send through Google."
      >
        <View style={{ paddingBottom: spacing.md }}>
          {directAddresses.map((address) => (
            <Touchable
              key={address}
              onPress={() => {
                update({ fromAddress: address, gmailAccountId: null });
                setFromOpen(false);
              }}
              haptic="light"
              style={[styles.fromOption, { borderBottomColor: palette.borderSoft }]}
            >
              <Avatar name={undefined} email={address} size={36} />
              <View style={{ flex: 1 }}>
                <AppText variant="small" weight="medium">
                  {address === user?.email ? user.displayName : address.split("@")[0]}
                </AppText>
                <AppText variant="caption" color={palette.faint}>
                  {address}
                  {address === user?.email ? " · Primary" : " · Alias"}
                </AppText>
              </View>
              {state.fromAddress === address ? (
                <Feather name="check-circle" size={18} color={palette.accent} />
              ) : null}
            </Touchable>
          ))}

          {gmailAccounts.filter((account) => account.enabled).length > 0 ? (
            <View style={{ paddingTop: spacing.lg, gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Feather name="mail" size={11} color={palette.faint} />
                <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                  Connected Gmail
                </AppText>
              </View>
              {gmailAccounts
                .filter((account) => account.enabled)
                .map((account) => (
                  <Touchable
                    key={account.id}
                    onPress={() => {
                      update({
                        fromAddress: account.googleEmail,
                        gmailAccountId: account.id,
                      });
                      setFromOpen(false);
                    }}
                    haptic="light"
                    style={[styles.fromOption, { borderBottomColor: palette.borderSoft }]}
                  >
                    <Avatar name={undefined} email={account.googleEmail} size={36} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <AppText variant="small" weight="medium">
                          {account.googleEmail}
                        </AppText>
                        <View style={[styles.gmailBadge, { backgroundColor: palette.pinkSoft }]}>
                          <AppText variant="micro" color={palette.pink} style={{ fontSize: 7.5 }}>
                            Gmail
                          </AppText>
                        </View>
                      </View>
                      <AppText variant="caption" color={palette.faint}>
                        Send via Google · outside NyxMail encryption
                      </AppText>
                    </View>
                    {state.fromAddress === account.googleEmail ? (
                      <Feather name="check-circle" size={18} color={palette.accent} />
                    ) : null}
                  </Touchable>
                ))}
            </View>
          ) : null}

          <Touchable
            onPress={connectGmail}
            disabled={gmailConnecting}
            haptic="light"
            style={[styles.connectGmail, { borderColor: palette.border }]}
          >
            {gmailConnecting ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <Feather name="plus-circle" size={15} color={palette.accent} />
            )}
            <View style={{ flex: 1 }}>
              <AppText variant="caption" weight="semibold" color={palette.accentStrong}>
                {gmailAccounts.length ? "Reconnect Gmail / add another" : "Connect a Gmail address"}
              </AppText>
              <AppText variant="micro" color={palette.faint} style={{ fontSize: 8.5 }}>
                Reconnect once to grant Gmail send permission.
              </AppText>
            </View>
          </Touchable>

          {directAddresses.length === 1 && gmailAccounts.length === 0 ? (
            <AppText variant="caption" color={palette.faint} style={{ paddingTop: spacing.lg }}>
              Add aliases in Settings → Aliases, or connect Gmail to send from another address.
            </AppText>
          ) : null}
        </View>
      </Sheet>

      <Sheet
        visible={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="When should it send?"
        description="Scheduled mail is encrypted at rest until delivery."
      >
        <View style={{ paddingBottom: spacing.md }}>
          {scheduleOptions.map((option) => (
            <Touchable
              key={option.label}
              onPress={() => {
                setScheduleAt(option.value);
                setScheduleOpen(false);
              }}
              haptic="light"
              style={[styles.scheduleOption, { borderBottomColor: palette.borderSoft }]}
            >
              <View
                style={[
                  styles.scheduleIcon,
                  {
                    backgroundColor:
                      (option.value?.getTime() ?? null) === scheduleAt?.getTime() && option.value
                        ? palette.accentSoft
                        : palette.surface,
                  },
                ]}
              >
                <Feather
                  name={option.value ? "clock" : "zap"}
                  size={15}
                  color={option.value ? palette.accent : palette.mint}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="small" weight="medium">
                  {option.label}
                </AppText>
                <AppText variant="caption" color={palette.faint}>
                  {option.hint}
                </AppText>
              </View>
              {option.value && option.value.getTime() === scheduleAt?.getTime() ? (
                <Feather name="check" size={16} color={palette.accent} />
              ) : null}
            </Touchable>
          ))}
        </View>
      </Sheet>
    </Modal>
  );
}

function AddressField({
  label,
  value,
  onChange,
  suggestions,
  exclude,
}: {
  label: string;
  value: Recipient[];
  onChange: (next: Recipient[]) => void;
  suggestions: ContactDTO[];
  exclude: string[];
}) {
  const palette = usePalette();
  const [query, setQuery] = useState("");
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return suggestions
      .filter(
        (contact) =>
          !value.some((recipient) => recipient.email.toLowerCase() === contact.email.toLowerCase()) &&
          !exclude.some((address) => address.toLowerCase() === contact.email.toLowerCase()) &&
          (contact.email.toLowerCase().includes(needle) ||
            contact.name.toLowerCase().includes(needle)),
      )
      .slice(0, 4);
  }, [exclude, query, suggestions, value]);

  const commit = (raw: string) => {
    const parsed = addressesFromMail(raw);
    if (!parsed.length) return;
    const additions = parsed
      .filter(
        (address) =>
          !value.some((recipient) => recipient.email.toLowerCase() === address.email.toLowerCase()),
      )
      .map((address) => ({ email: address.email, name: address.name }));
    onChange([...value, ...additions]);
    setQuery("");
  };

  return (
    <View style={[styles.addressRow, { borderBottomColor: palette.borderSoft }]}>
      <AppText variant="caption" color={palette.faint} style={{ width: 46 }}>
        {label}
      </AppText>
      <View style={{ flex: 1, gap: spacing.sm }}>
        {value.length > 0 ? (
          <View style={styles.chips}>
            {value.map((recipient) => (
              <View
                key={recipient.email}
                style={[
                  styles.recipientChip,
                  { backgroundColor: palette.surfaceRaised, borderColor: palette.border },
                ]}
              >
                <AppText variant="caption" color={palette.inkSoft} numberOfLines={1} style={{ maxWidth: 150 }}>
                  {recipient.name || recipient.email}
                </AppText>
                <Touchable
                  onPress={() =>
                    onChange(value.filter((item) => item.email !== recipient.email))
                  }
                  haptic="none"
                  accessibilityLabel={`Remove ${recipient.email}`}
                >
                  <Feather name="x" size={12} color={palette.faint} />
                </Touchable>
              </View>
            ))}
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={(next) => {
            if (/[,;]$/.test(next)) {
              commit(next);
            } else {
              setQuery(next);
            }
          }}
          onSubmitEditing={() => commit(query)}
          onBlur={() => {
            if (isEmail(query)) commit(query);
          }}
          placeholder={value.length ? "Add another…" : `Add ${label.toLowerCase()} recipients`}
          placeholderTextColor={palette.faint}
          selectionColor={palette.accent}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="done"
          style={{
            color: palette.ink,
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            padding: 0,
            minHeight: 24,
          }}
        />
        {filtered.length > 0 ? (
          <View
            style={[
              styles.suggestions,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            {filtered.map((contact) => (
              <Touchable
                key={contact.id}
                onPress={() => {
                  onChange([
                    ...value,
                    { email: contact.email, name: contact.name || undefined },
                  ]);
                  setQuery("");
                  inputRef.current?.focus();
                }}
                haptic="light"
                style={[styles.suggestion, { borderBottomColor: palette.borderSoft }]}
              >
                <Avatar name={contact.name} email={contact.email} size={28} />
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" weight="medium">
                    {contact.name || contact.email}
                  </AppText>
                  {contact.name ? (
                    <AppText variant="micro" color={palette.faint} style={{ fontSize: 9 }}>
                      {contact.email}
                    </AppText>
                  ) : null}
                </View>
                <Feather name="plus" size={13} color={palette.accent} />
              </Touchable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sendButton: {
    height: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scheduleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  meta: { paddingHorizontal: spacing.xl },
  fromRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fromInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  ccRow: {
    paddingVertical: spacing.md,
    paddingLeft: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addressRow: {
    flexDirection: "row",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  recipientChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  suggestions: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subjectRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  body: {
    fontSize: 15,
    lineHeight: 23,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  quoteBox: {
    marginHorizontal: spacing.xl,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    gap: 4,
  },
  attachments: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.sm },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  errorBox: {
    flexDirection: "row",
    gap: spacing.sm,
    margin: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: "flex-start",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  fromOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scheduleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scheduleIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  gmailBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  connectGmail: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
