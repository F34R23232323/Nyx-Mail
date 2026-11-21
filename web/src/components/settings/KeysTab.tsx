"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Fingerprint, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { publicKeyFingerprint } from "@nyxmail/crypto";
import { useAuth } from "@/lib/client/auth";
import { useCrypto } from "@/lib/client/crypto";
import { useToast } from "@/lib/client/toast";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/Button";
import { copyText, downloadBlob, downloadText } from "@/lib/client/utils";

export function KeysTab() {
  const { user } = useAuth();
  const { bundle } = useCrypto();
  const { toast } = useToast();
  const [fingerprint, setFingerprint] = useState("");
  const [signingFingerprint, setSigningFingerprint] = useState("");

  useEffect(() => {
    if (!user) return;
    void publicKeyFingerprint(user.publicKey).then(setFingerprint).catch(() => undefined);
    void publicKeyFingerprint(user.signingPublicKey).then(setSigningFingerprint).catch(() => undefined);
  }, [user]);

  if (!user) return null;

  const downloadPublicKeys = () => {
    downloadText(
      [
        "NYXMAIL PUBLIC KEY BUNDLE",
        `Account: ${user.email}`,
        "",
        `X25519 encryption public key: ${user.publicKey}`,
        `Ed25519 signing public key:  ${user.signingPublicKey}`,
        "",
        "Private keys are never exported in plaintext.",
      ].join("\n"),
      "nyxmail-public-keys.txt",
    );
  };

  const downloadEncryptedKey = async () => {
    try {
      const data = await apiFetch<{
        key: { encryptedPrivateKey: string; argonSalt: string; publicKey: string; signingPublicKey: string };
      }>("/api/v1/keys");
      const payload = {
        format: "nyxmail-encrypted-key-v1",
        email: user.email,
        note: "This is an encrypted private key bundle. It can only be unlocked with your password or recovery phrase.",
        ...data.key,
      };
      downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        "nyxmail-encrypted-key.json",
      );
      toast({ title: "Encrypted key backup downloaded", tone: "success" });
    } catch {
      toast({ title: "Could not export encrypted key", tone: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Your key hierarchy</h2>
            <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted">
              X25519 is used for sealing message keys. Ed25519 is generated for signed envelopes. The private
              bundle is encrypted with a 256-bit Argon2id-derived key and a separate 24-word recovery key.
            </p>
          </div>
          <span className="chip border-success/20 bg-success/[0.06] text-success">
            <ShieldCheck className="h-3 w-3" /> unlocked
          </span>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-accent2" />
              <p className="text-xs font-semibold text-ink">X25519 encryption key</p>
            </div>
            <p className="mt-1 text-[10px] text-faint">Fingerprint</p>
            <p className="mt-1 break-all font-mono text-[10.5px] leading-relaxed text-muted">
              {fingerprint || "calculating…"}
            </p>
            <p className="mt-3 break-all rounded-lg bg-surface px-2 py-2 font-mono text-[9px] text-faint">
              {user.publicKey}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-accent2" />
              <p className="text-xs font-semibold text-ink">Ed25519 signing key</p>
            </div>
            <p className="mt-1 text-[10px] text-faint">Fingerprint</p>
            <p className="mt-1 break-all font-mono text-[10.5px] leading-relaxed text-muted">
              {signingFingerprint || "calculating…"}
            </p>
            <p className="mt-3 break-all rounded-lg bg-surface px-2 py-2 font-mono text-[9px] text-faint">
              {user.signingPublicKey}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={downloadPublicKeys} icon={<Download className="h-4 w-4" />}>
            Download public keys
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await copyText(user.publicKey);
              toast({ title: "Public key copied", tone: "success" });
            }}
            icon={<Copy className="h-4 w-4" />}
          >
            Copy encryption key
          </Button>
          <Button variant="secondary" onClick={() => void downloadEncryptedKey()} icon={<LockKeyhole className="h-4 w-4" />}>
            Download encrypted key backup
          </Button>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">What the server can see</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            ["Ciphertext", "Subjects, bodies, attachment bytes and attachment keys."],
            ["Wrapped keys", "One X25519 sealed message key per recipient copy."],
            ["Envelope metadata", "From, To, Cc, Bcc, timestamps, size and folder."],
            ["Attachments metadata", "Filenames, MIME types and encrypted sizes."],
            ["Auth results", "SPF, DKIM and DMARC verdicts from your MTA."],
            ["Public keys", "Your X25519 and Ed25519 public keys."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-xl border border-border bg-canvas px-3 py-2.5">
              <p className="text-[11px] font-medium text-ink">{title}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-warning/20 bg-warning/[0.05] p-3 text-[10.5px] leading-relaxed text-muted">
          <span className="font-semibold text-warning">Important:</span> mail to external recipients is relayed
          over SMTP, so the server necessarily sees that plaintext in transit. Internal deliveries, inbound
          store-and-forward, drafts and everything at rest remain ciphertext.
        </div>
      </section>

      {bundle ? (
        <section className="card p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-ink">Session key status</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Your private bundle is currently in React memory for this tab. It is cleared automatically when
            you sign out, lose the session, or close the tab. Reloading asks for your password again.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="chip">bundle v{bundle.version}</span>
            <span className="chip">X25519 private key in memory</span>
            <span className="chip">Ed25519 private key in memory</span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
