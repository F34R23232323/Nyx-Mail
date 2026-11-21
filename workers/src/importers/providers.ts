import type { ImportJob } from "@nyxmail/db";
import { parseEml, parseMbox, type ParsedMessage } from "@nyxmail/server";
import { runImapImport } from "./imap";

/**
 * Adapter for job-based mailbox ingestion. Add a new provider (for example
 * Proton Bridge or an Exchange EWS bridge) by implementing this interface and
 * dispatching it from the worker loop.
 */
export interface MailIngestProvider<TInput = ImportJob> {
  readonly name: string;
  ingest(input: TInput): Promise<void>;
}

export class ImapImporter implements MailIngestProvider {
  readonly name = "imap";

  async ingest(job: ImportJob): Promise<void> {
    await runImapImport(job);
  }
}

/**
 * Adapter for file/MIME parsing. These providers expose an async stream so
 * large mbox files can be consumed incrementally by future ingest pipelines.
 */
export interface MailContentParser {
  readonly name: string;
  parse(input: Buffer | string): AsyncGenerator<ParsedMessage>;
}

export class MboxParser implements MailContentParser {
  readonly name = "mbox";

  async *parse(input: Buffer | string): AsyncGenerator<ParsedMessage> {
    yield* parseMbox(input);
  }
}

export class EmlParser implements MailContentParser {
  readonly name = "eml";

  async *parse(input: Buffer | string): AsyncGenerator<ParsedMessage> {
    yield await parseEml(input);
  }
}
