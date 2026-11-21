import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { useAuth } from "../../lib/auth";
import { apiFetch, ApiError } from "../../lib/api";
import {
  createKeyEnvelope,
  createRecoveryKit,
  generateKeyBundle,
  type KeyBundle,
} from "../../lib/crypto";
import { isEmail } from "../../lib/format";
import type { RootScreenProps } from "../../navigation/types";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { LogoMark } from "../../components/ui/Logo";
import { TextField } from "../../components/ui/TextField";
import { Touchable } from "../../components/ui/Touchable";
import { useToast } from "../../components/ui/Toast";
import { OtpInput } from "../../components/auth/OtpInput";

type Step = "form" | "recovery" | "totp" | "backup";

interface SetupData {
  setupToken: string;
  qrDataUrl: string;
  otpauthUri: string;
  secret: string;
  email: string;
}

function passwordScore(password: string): { score: number; label: string; color: "danger" | "warning" | "mint" } {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 2) return { score: Math.max(1, score), label: "Weak", color: "danger" };
  if (score <= 3) return { score, label: "Fair", color: "warning" };
  if (score === 4) return { score, label: "Strong", color: "mint" };
  return { score: 5, label: "Excellent", color: "mint" };
}

export function SignupScreen({ navigation }: RootScreenProps<"Signup">) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { adoptSession } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("form");
  const [domains, setDomains] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [progress, setProgress] = useState(0);
  const [bundle, setBundle] = useState<KeyBundle | null>(null);
  const [phrase, setPhrase] = useState("");
  const [savedPhrase, setSavedPhrase] = useState(false);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [account, setAccount] = useState<{ user: import("../../lib/types").UserDTO; csrf: string } | null>(null);

  useEffect(() => {
    apiFetch<{ signupDomains: string[] }>("/api/v1/config", { retryAuth: false })
      .then((data) => {
        if (data.signupDomains?.length) {
          setDomains(data.signupDomains);
        }
      })
      .catch(() => undefined);
  }, []);

  const strength = useMemo(() => passwordScore(password), [password]);
  const words = useMemo(() => (phrase ? phrase.split(" ") : []), [phrase]);

  const submit = async () => {
    setError(null);
    if (!displayName.trim()) return setError("Add a display name.");
    if (!isEmail(email.trim())) return setError("Enter a valid email address.");
    if (domains.length > 0) {
      const domain = email.split("@")[1]?.toLowerCase();
      if (!domains.includes(domain)) {
        return setError(`Signups are restricted to ${domains.map((item) => `@${item}`).join(", ")}.`);
      }
    }
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (!/[a-z]/i.test(password)) return setError("Include at least one letter.");
    if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      return setError("Include a number or symbol.");
    }
    if (password !== confirm) return setError("Passwords do not match.");
    if (recoveryEmail && (!isEmail(recoveryEmail) || recoveryEmail.toLowerCase() === email.toLowerCase())) {
      return setError("Recovery email must be a different, valid address.");
    }
    setBusy(true);
    setBusyLabel("Generating your X25519 keys…");
    setProgress(2);
    try {
      const keyBundle = await generateKeyBundle();
      setBusyLabel("Encrypting your key with Argon2id…");
      const envelope = await createKeyEnvelope(keyBundle, password, (fraction) =>
        setProgress(4 + Math.round(fraction * 38)),
      );
      setBusyLabel("Creating your 24-word recovery kit…");
      const kit = await createRecoveryKit(keyBundle, (fraction) =>
        setProgress(44 + Math.round(fraction * 42)),
      );
      setBusyLabel("Creating your encrypted account…");
      setProgress(90);
      const data = await apiFetch<{
        setupToken: string;
        totpSecret: string;
        otpauthUri: string;
        qrDataUrl: string;
        email: string;
        displayName: string;
      }>("/api/v1/auth/signup", {
        method: "POST",
        retryAuth: false,
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          displayName: displayName.trim(),
          password,
          publicKey: keyBundle.publicKey,
          signingPublicKey: keyBundle.signingPublicKey,
          encryptedPrivateKey: envelope.encryptedPrivateKey,
          argonSalt: envelope.argonSalt,
          recoveryEncryptedPrivateKey: kit.encryptedPrivateKey,
          recoverySalt: kit.argonSalt,
          recoveryKeyHash: kit.recoveryKeyHash,
          recoveryEmail: recoveryEmail.trim() || undefined,
        }),
      });
      setBundle(keyBundle);
      setPhrase(kit.phrase);
      setSetup({
        setupToken: data.setupToken,
        qrDataUrl: data.qrDataUrl,
        otpauthUri: data.otpauthUri,
        secret: data.totpSecret,
        email: data.email,
      });
      setProgress(100);
      setStep("recovery");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your account could not be created.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const enableTotp = async (value = code) => {
    if (!setup || busy) return;
    if (value.trim().length < 6) return setError("Enter the 6-digit code from your authenticator.");
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<{
        user: import("../../lib/types").UserDTO;
        backupCodes: string[];
        csrfToken: string;
      }>("/api/v1/auth/two-factor/enable", {
        method: "POST",
        retryAuth: false,
        body: JSON.stringify({ setupToken: setup.setupToken, code: value.trim() }),
      });
      setBackupCodes(data.backupCodes);
      setAccount({ user: data.user, csrf: data.csrfToken });
      setStep("backup");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That code could not be verified.");
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    if (!bundle || !account) return;
    adoptSession(account.user, bundle, account.csrf);
    toast({ title: "Welcome to NyxMail", description: "Your encrypted mailbox is ready.", tone: "success" });
  };

  const copyPhrase = async () => {
    await Clipboard.setStringAsync(phrase);
    toast({ title: "Recovery phrase copied", tone: "success" });
  };

  const copyCodes = async () => {
    await Clipboard.setStringAsync(backupCodes.join("\n"));
    toast({ title: "Backup codes copied", tone: "success" });
  };

  const stepNumber = step === "form" ? 1 : step === "recovery" ? 2 : step === "totp" ? 3 : 4;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <LinearGradient
        colors={["rgba(138,120,255,0.16)", "rgba(8,9,13,0)"]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + spacing.sm,
            paddingBottom: insets.bottom + spacing.xxl,
            paddingHorizontal: spacing.xl,
            gap: spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <IconButton
              name="x"
              size={38}
              accessibilityLabel="Close signup"
              onPress={() => {
                if (step === "form") return navigation.goBack();
                if (step === "backup") {
                  Alert.alert("Finish setup first", "Save your backup codes, then tap Start using NyxMail.");
                  return;
                }
                Alert.alert(
                  "Leave setup?",
                  "Your account already exists. If you leave now, you can sign in later and finish two-factor setup, but you will not see the recovery phrase again.",
                  [
                    { text: "Keep setting up", style: "cancel" },
                    { text: "Leave", style: "destructive", onPress: () => navigation.goBack() },
                  ],
                );
              }}
            />
            <LogoMark size={32} />
            <View style={styles.steps}>
              {[1, 2, 3, 4].map((number) => (
                <View
                  key={number}
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor:
                        number <= stepNumber ? palette.accent : palette.surfaceRaised,
                      width: number === stepNumber ? 16 : 6,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          {step === "form" ? (
            <>
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Feather name="lock" size={13} color={palette.mint} />
                  <AppText variant="micro" color={palette.mint}>
                    End-to-end encrypted from day one
                  </AppText>
                </View>
                <AppText variant="display">Create your mailbox</AppText>
                <AppText variant="small" color={palette.muted} style={{ lineHeight: 21 }}>
                  Your keys are generated on this phone. Only you can read the mail that arrives.
                </AppText>
              </View>

              <View
                style={[
                  styles.card,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <TextField
                  label="Display name"
                  placeholder="Ada Lovelace"
                  icon="user"
                  value={displayName}
                  onChangeText={setDisplayName}
                  maxLength={80}
                  autoCapitalize="words"
                />
                <TextField
                  label="Email address"
                  placeholder="you@yourdomain.com"
                  icon="at-sign"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {domains.length > 0 ? (
                  <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
                    {domains.slice(0, 4).map((domain) => (
                      <Touchable
                        key={domain}
                        onPress={() => {
                          const local = email.split("@")[0] || "you";
                          setEmail(`${local}@${domain}`);
                        }}
                        haptic="light"
                        style={[
                          styles.domainChip,
                          {
                            backgroundColor:
                              email.endsWith(`@${domain}`) ? palette.accentSoft : palette.surfaceRaised,
                            borderColor:
                              email.endsWith(`@${domain}`) ? palette.accent : palette.border,
                          },
                        ]}
                      >
                        <AppText
                          variant="micro"
                          color={email.endsWith(`@${domain}`) ? palette.accentStrong : palette.muted}
                          style={{ fontSize: 8.5 }}
                        >
                          @{domain}
                        </AppText>
                      </Touchable>
                    ))}
                  </View>
                ) : null}
                <View style={{ gap: spacing.sm }}>
                  <TextField
                    label="Password"
                    placeholder="At least 10 characters"
                    icon="key"
                    value={password}
                    onChangeText={setPassword}
                    secure
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                  />
                  {password ? (
                    <View style={{ gap: 5 }}>
                      <View style={{ flexDirection: "row", gap: 3 }}>
                        {[1, 2, 3, 4, 5].map((bar) => (
                          <View
                            key={bar}
                            style={[
                              styles.strengthBar,
                              {
                                backgroundColor:
                                  bar <= strength.score
                                    ? strength.color === "danger"
                                      ? palette.danger
                                      : strength.color === "warning"
                                        ? palette.warning
                                        : palette.mint
                                    : palette.surfaceRaised,
                              },
                            ]}
                          />
                        ))}
                      </View>
                      <AppText
                        variant="micro"
                        color={
                          strength.color === "danger"
                            ? palette.danger
                            : strength.color === "warning"
                              ? palette.warning
                              : palette.mint
                        }
                        style={{ fontSize: 8.5 }}
                      >
                        {strength.label} password
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <TextField
                  label="Confirm password"
                  placeholder="Repeat your password"
                  icon="key"
                  value={confirm}
                  onChangeText={setConfirm}
                  secure
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                />
                <TextField
                  label="Recovery email (optional)"
                  placeholder="backup@example.com"
                  icon="life-buoy"
                  value={recoveryEmail}
                  onChangeText={setRecoveryEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  hint="For account notices only. It cannot decrypt your mailbox."
                />

                {error ? (
                  <View
                    style={[
                      styles.errorBox,
                      { backgroundColor: palette.dangerSoft, borderColor: "rgba(255,113,133,0.22)" },
                    ]}
                  >
                    <Feather name="alert-circle" size={15} color={palette.danger} />
                    <AppText variant="caption" color={palette.danger} style={{ flex: 1 }}>
                      {error}
                    </AppText>
                  </View>
                ) : null}

                {busy ? (
                  <View style={{ gap: spacing.sm }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <AppText variant="caption" color={palette.muted}>
                        {busyLabel}
                      </AppText>
                      <AppText variant="caption" color={palette.accentStrong} weight="semibold">
                        {progress}%
                      </AppText>
                    </View>
                    <View style={[styles.track, { backgroundColor: palette.surfaceRaised }]}>
                      <View
                        style={[
                          styles.bar,
                          { backgroundColor: palette.accent, width: `${Math.max(3, progress)}%` },
                        ]}
                      />
                    </View>
                  </View>
                ) : null}

                <Button
                  label="Create encrypted account"
                  icon="shield"
                  size="lg"
                  loading={busy}
                  onPress={submit}
                />
                <View style={styles.legalRow}>
                  <Feather name="lock" size={11} color={palette.faint} />
                  <AppText variant="caption" color={palette.faint} style={{ flex: 1, lineHeight: 17 }}>
                    The server receives only your public keys and encrypted key bundle. Your password
                    is never sent in plaintext.
                  </AppText>
                </View>
              </View>
              <Touchable onPress={() => navigation.goBack()} haptic="light" style={{ alignSelf: "center" }}>
                <AppText variant="small" color={palette.muted}>
                  Already have a mailbox?{" "}
                  <AppText variant="small" weight="semibold" color={palette.accentStrong}>
                    Sign in
                  </AppText>
                </AppText>
              </Touchable>
            </>
          ) : null}

          {step === "recovery" ? (
            <>
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={[styles.stepBadge, { backgroundColor: palette.accentSoft }]}>
                    <AppText variant="micro" color={palette.accentStrong} style={{ fontSize: 8.5 }}>
                      Step 2 of 4
                    </AppText>
                  </View>
                </View>
                <AppText variant="display">Save your recovery kit</AppText>
                <AppText variant="small" color={palette.muted} style={{ lineHeight: 21 }}>
                  These 24 words are the only way to recover your encrypted mailbox if you forget your
                  password. Write them down offline.
                </AppText>
              </View>

              <View
                style={[
                  styles.card,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <View style={styles.words}>
                  {words.map((word, index) => (
                    <View
                      key={`${word}-${index}`}
                      style={[styles.word, { backgroundColor: palette.surfaceRaised }]}
                    >
                      <AppText variant="micro" color={palette.faint} style={{ fontSize: 8, width: 16 }}>
                        {index + 1}
                      </AppText>
                      <AppText variant="caption" weight="medium" style={{ fontSize: 11.5 }}>
                        {word}
                      </AppText>
                    </View>
                  ))}
                </View>
                <Touchable
                  onPress={copyPhrase}
                  haptic="light"
                  style={[styles.copyRow, { borderColor: palette.border }]}
                >
                  <Feather name="copy" size={14} color={palette.accent} />
                  <AppText variant="caption" weight="medium" color={palette.accentStrong}>
                    Copy recovery phrase
                  </AppText>
                </Touchable>
              </View>

              <Touchable
                onPress={() => setSavedPhrase((value) => !value)}
                haptic="light"
                style={[styles.checkRow, { borderColor: palette.border, backgroundColor: palette.surface }]}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      backgroundColor: savedPhrase ? palette.accent : "transparent",
                      borderColor: savedPhrase ? palette.accent : palette.borderStrong,
                    },
                  ]}
                >
                  {savedPhrase ? <Feather name="check" size={12} color="#FFFFFF" /> : null}
                </View>
                <AppText variant="caption" color={palette.muted} style={{ flex: 1, lineHeight: 18 }}>
                  I have written down my 24 words and stored them somewhere safe.
                </AppText>
              </Touchable>

              <View
                style={[
                  styles.warning,
                  { backgroundColor: palette.warningSoft, borderColor: "rgba(242,185,92,0.18)" },
                ]}
              >
                <Feather name="alert-triangle" size={14} color={palette.warning} />
                <AppText variant="caption" color={palette.warning} style={{ flex: 1, lineHeight: 18 }}>
                  NyxMail cannot regenerate this phrase. Anyone with it can recover your mailbox, so
                  keep it offline.
                </AppText>
              </View>

              <Button
                label="Continue to two-factor"
                icon="arrow-right"
                size="lg"
                disabled={!savedPhrase}
                onPress={() => {
                  setError(null);
                  setStep("totp");
                }}
              />
            </>
          ) : null}

          {step === "totp" && setup ? (
            <>
              <View style={{ gap: spacing.sm }}>
                <AppText variant="micro" color={palette.accentStrong}>
                  Step 3 of 4
                </AppText>
                <AppText variant="display">Add two-factor</AppText>
                <AppText variant="small" color={palette.muted} style={{ lineHeight: 21 }}>
                  Scan this code with your authenticator app, then enter the six-digit code it shows.
                </AppText>
              </View>
              <View
                style={[
                  styles.card,
                  { backgroundColor: palette.surface, borderColor: palette.border, alignItems: "center" },
                ]}
              >
                <View style={styles.qrWrap}>
                  <Image source={{ uri: setup.qrDataUrl }} style={{ width: 200, height: 200 }} />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Feather name="mail" size={11} color={palette.faint} />
                  <AppText variant="caption" color={palette.faint}>
                    {setup.email}
                  </AppText>
                </View>
                <OtpInput
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    setError(null);
                  }}
                  error={Boolean(error)}
                  autoFocus={false}
                  onComplete={(value) => void enableTotp(value)}
                />
                {error ? (
                  <View
                    style={[
                      styles.errorBox,
                      { backgroundColor: palette.dangerSoft, borderColor: "rgba(255,113,133,0.22)" },
                    ]}
                  >
                    <Feather name="alert-circle" size={15} color={palette.danger} />
                    <AppText variant="caption" color={palette.danger} style={{ flex: 1 }}>
                      {error}
                    </AppText>
                  </View>
                ) : null}
                <Button
                  label="Verify & enable"
                  icon="shield"
                  size="lg"
                  loading={busy}
                  onPress={() => void enableTotp()}
                />
                <Touchable
                  onPress={async () => {
                    await Clipboard.setStringAsync(setup.otpauthUri);
                    toast({ title: "Setup link copied", tone: "success" });
                  }}
                  haptic="light"
                >
                  <AppText variant="caption" color={palette.accentStrong}>
                    Copy setup link instead
                  </AppText>
                </Touchable>
              </View>
            </>
          ) : null}

          {step === "backup" ? (
            <>
              <View style={{ gap: spacing.sm }}>
                <AppText variant="micro" color={palette.mint}>
                  Step 4 of 4
                </AppText>
                <AppText variant="display">Save your backup codes</AppText>
                <AppText variant="small" color={palette.muted} style={{ lineHeight: 21 }}>
                  Each code works once. Use one if you lose access to your authenticator app.
                </AppText>
              </View>
              <View
                style={[
                  styles.card,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <View style={styles.codes}>
                  {backupCodes.map((backupCode, index) => (
                    <View key={backupCode} style={styles.codeCell}>
                      <AppText variant="micro" color={palette.faint} style={{ fontSize: 8, width: 16 }}>
                        {index + 1}
                      </AppText>
                      <AppText variant="caption" weight="semibold" style={{ letterSpacing: 1.1 }}>
                        {backupCode}
                      </AppText>
                    </View>
                  ))}
                </View>
                <Touchable
                  onPress={copyCodes}
                  haptic="light"
                  style={[styles.copyRow, { borderColor: palette.border }]}
                >
                  <Feather name="copy" size={14} color={palette.accent} />
                  <AppText variant="caption" weight="medium" color={palette.accentStrong}>
                    Copy all codes
                  </AppText>
                </Touchable>
              </View>
              <Button label="Start using NyxMail" icon="arrow-right" size="lg" onPress={finish} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  steps: { flexDirection: "row", alignItems: "center", gap: 4, height: 20 },
  stepDot: { height: 6, borderRadius: 3 },
  card: {
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  domainChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  bar: { height: 6, borderRadius: 3 },
  errorBox: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  legalRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  stepBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 5 },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  word: {
    width: "48.8%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.sm,
  },
  copyRow: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  qrWrap: {
    backgroundColor: "#FFFFFF",
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  codes: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  codeCell: {
    width: "48.8%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
});
