import { z } from "zod";
import {
  RULE_ACTION_TYPES,
  RULE_FIELDS,
  RULE_MATCH_TYPES,
  RULE_MODES,
  RULE_OPERATORS,
  isEmail,
  normalizeEmail,
} from "@nyxmail/shared";
import { isValidDomain, normalizeDomain } from "@nyxmail/shared/domains";

const addressSchema = z.object({
  name: z.string().trim().max(160).optional(),
  email: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid email address"),
});

const addressListSchema = z.array(addressSchema).max(100);
const addressesSchema = addressListSchema.transform((items) =>
  items.map((item) => ({ name: item.name || undefined, email: normalizeEmail(item.email) })),
);

const base64Key = z.string().trim().min(16).max(200);
const sealedBlob = z.string().min(20).max(30_000_000);

const attachmentInputSchema = z.object({
  blobId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().nonnegative().max(25 * 1024 * 1024),
  contentId: z.string().max(500).nullish(),
  inline: z.boolean().optional(),
});

const sealedSchema = z.object({
  encryptedSubject: sealedBlob,
  encryptedBody: sealedBlob,
  wraps: z.record(z.string().max(500), base64Key),
  sizeBytes: z.number().int().nonnegative().max(100 * 1024 * 1024),
});

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Password is too long")
  .refine((value) => /[a-z]/i.test(value), "Include at least one letter")
  .refine((value) => /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(value), "Include a number or symbol");

export const signupSchema = z.object({
  email: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid email address"),
  displayName: z.string().trim().min(1).max(80),
  password: passwordSchema,
  publicKey: base64Key,
  signingPublicKey: base64Key,
  encryptedPrivateKey: z.string().min(50).max(200_000),
  argonSalt: z.string().min(10).max(100),
  recoveryEncryptedPrivateKey: z.string().min(50).max(200_000),
  recoverySalt: z.string().min(10).max(100),
  recoveryKeyHash: z.string().length(64),
  recoveryEmail: z.string().trim().refine((v) => !v || isEmail(v), "Invalid recovery email").optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid email address"),
  password: z.string().min(1).max(200),
});

export const verifySchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("totp"),
    mfaToken: z.string().min(20),
    code: z.string().trim().min(6).max(8),
  }),
  z.object({
    method: z.literal("backup"),
    mfaToken: z.string().min(20),
    code: z.string().trim().min(6).max(24),
  }),
]);

export const setupTokenSchema = z.object({ setupToken: z.string().min(20) });

export const enableTwoFactorSchema = z.object({
  setupToken: z.string().min(20),
  code: z.string().trim().min(6).max(8),
});

export const regenerateBackupCodesSchema = z.object({
  code: z.string().trim().min(6).max(8),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
  encryptedPrivateKey: z.string().min(50).max(200_000),
  argonSalt: z.string().min(10).max(100),
});

export const recoveryStartSchema = z.object({
  email: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid email address"),
  phraseHash: z.string().length(64),
});

export const recoveryCompleteSchema = z.object({
  email: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid email address"),
  phraseHash: z.string().length(64),
  newPassword: passwordSchema,
  encryptedPrivateKey: z.string().min(50).max(200_000),
  argonSalt: z.string().min(10).max(100),
});

export const accountUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  recoveryEmail: z.string().trim().max(320).refine((v) => !v || isEmail(v), "Invalid recovery email").nullable().optional(),
  signatureText: z.string().max(10_000).nullable().optional(),
  signatureHtml: z.string().max(50_000).nullable().optional(),
});

export const accountEmailChangeSchema = z.object({
  email: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid email address"),
  password: z.string().min(1).max(200),
  code: z.string().trim().regex(/^\d{6,8}$/, "Enter a 6-digit authenticator code"),
});

export const aliasCreateSchema = z.object({
  address: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid alias address"),
});

const optionalCatchAll = z
  .union([
    z.string().trim().max(320).refine((value) => !value || isEmail(value), "Invalid catch-all address"),
    z.null(),
  ])
  .optional();

export const domainCreateSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, "Enter a domain")
    .max(253)
    .transform(normalizeDomain)
    .refine(isValidDomain, "Enter a valid domain such as example.com"),
  allowSignup: z.boolean().optional().default(false),
  catchAllAddress: optionalCatchAll,
  generateDkim: z.boolean().optional().default(true),
});

export const domainUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  allowSignup: z.boolean().optional(),
  catchAllAddress: optionalCatchAll,
  regenerateDkim: z.boolean().optional(),
});

export const folderCreateSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

export const folderUpdateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  order: z.number().int().min(0).max(1000).optional(),
});

export const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8B5CF6"),
});

export const labelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const contactCreateSchema = z.object({
  name: z.string().trim().max(160).default(""),
  email: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid email address"),
});

export const contactMergeSchema = z.object({
  ids: z.array(z.string()).min(2).max(100),
  name: z.string().trim().max(160).optional(),
});

export const draftSchema = z.object({
  id: z.string().cuid().nullish(),
  fromAddress: z.string().refine((v) => isEmail(v), "Invalid sender").optional(),
  to: addressesSchema.default([]),
  cc: addressesSchema.default([]),
  bcc: addressesSchema.default([]),
  sealed: sealedSchema,
  attachments: z.array(attachmentInputSchema).max(50).default([]),
  inReplyTo: z.string().max(1000).nullish(),
  references: z.array(z.string().max(1000)).max(100).default([]),
  threadId: z.string().cuid().nullish(),
});

export const sendSchema = z.object({
  fromAddress: z.string().refine((v) => isEmail(v), "Invalid sender"),
  gmailAccountId: z.string().cuid().nullish(),
  to: addressListSchema.min(1).max(100),
  cc: addressesSchema.default([]),
  bcc: addressesSchema.default([]),
  sealed: sealedSchema,
  draftId: z.string().cuid().nullish(),
  threadId: z.string().cuid().nullish(),
  inReplyTo: z.string().max(1000).nullish(),
  references: z.array(z.string().max(1000)).max(100).default([]),
  scheduledFor: z.string().datetime().nullish(),
  relay: z
    .object({
      subject: z.string().min(1).max(998),
      html: z.string().max(5_000_000),
      text: z.string().max(5_000_000),
      attachmentKeys: z.record(z.string(), base64Key).optional(),
    })
    .nullish(),
  attachments: z.array(attachmentInputSchema).max(50).default([]),
});

export const messagePatchSchema = z.object({
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  folderId: z.string().cuid().optional(),
  labelIds: z.array(z.string().cuid()).max(50).optional(),
  addLabelIds: z.array(z.string().cuid()).max(50).optional(),
  removeLabelIds: z.array(z.string().cuid()).max(50).optional(),
  snoozeUntil: z.string().datetime().nullable().optional(),
});

export const bulkSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(500),
  action: z.enum(["read", "unread", "star", "unstar", "archive", "trash", "spam", "delete", "move"]),
  folderId: z.string().cuid().optional(),
});

export const importImapSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(500),
});

export const importActionSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

export const filterSchema = z.object({
  kind: z.enum(["BLOCK", "ALLOW"]),
  pattern: z.string().trim().min(2).max(320),
});

export const webauthnRegisterVerifySchema = z.object({
  flowToken: z.string().min(20),
  response: z.any(),
  name: z.string().trim().max(60).optional(),
});

export const webauthnAuthOptionsSchema = z.object({
  mfaToken: z.string().min(20),
});

export const webauthnAuthVerifySchema = z.object({
  mfaToken: z.string().min(20),
  flowToken: z.string().min(20),
  response: z.any(),
});

export const searchIndexQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});


const ruleConditionSchema = z.object({
  field: z.enum(RULE_FIELDS),
  operator: z.enum(RULE_OPERATORS),
  value: z.union([z.string().max(500), z.number().finite(), z.boolean()]),
});

const ruleActionSchema = z.object({
  type: z.enum(RULE_ACTION_TYPES),
  folderId: z.string().cuid().optional(),
  labelIds: z.array(z.string().cuid()).max(50).optional(),
});

export const mailRuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  mode: z.enum(RULE_MODES).default("VISUAL"),
  matchType: z.enum(RULE_MATCH_TYPES).default("ALL"),
  conditions: z.array(ruleConditionSchema).max(20).default([]),
  actions: z.array(ruleActionSchema).max(10).default([]),
  sieveScript: z.string().max(20_000).optional(),
  stopProcessing: z.boolean().default(false),
});

export const mailRuleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(RULE_MODES).optional(),
  matchType: z.enum(RULE_MATCH_TYPES).optional(),
  conditions: z.array(ruleConditionSchema).max(20).optional(),
  actions: z.array(ruleActionSchema).max(10).optional(),
  sieveScript: z.string().max(20_000).optional(),
  stopProcessing: z.boolean().optional(),
});

export const mailRuleReorderSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(100),
});

export const sieveValidateSchema = z.object({
  script: z.string().trim().min(1).max(20_000),
});


export const protonImportSchema = z.object({
  host: z.string().trim().min(1).max(255).default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(1143),
  username: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(500),
});
