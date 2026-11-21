export interface ImapImportConfig {
  kind: "imap";
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export interface ProtonImportConfig {
  kind: "proton";
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ProtonExportConfig {
  kind: "proton-export";
  storagePath: string;
  originalName: string;
}

export interface GmailImportConfig {
  kind: "gmail";
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  googleEmail?: string;
}

export interface FileImportConfig {
  kind: "file";
  format: "mbox" | "eml";
  storagePath: string;
  originalName: string;
}

export type ImportConfig = ImapImportConfig | ProtonImportConfig | ProtonExportConfig | GmailImportConfig | FileImportConfig;

export interface ImportProgressUpdate {
  processed: number;
  total?: number;
  cursor?: string | null;
  error?: string;
  folderMapping?: Record<string, string>;
}
