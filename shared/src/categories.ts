/**
 * Built-in automatic mail filters.
 *
 * Classification happens before messages are encrypted (SMTP ingest) and is
 * also available to the browser for older messages that do not have stored
 * categories yet. The rules are deliberately conservative: a message is only
 * tagged when a strong signal is present, so ordinary personal mail stays in
 * Primary.
 */

export const MESSAGE_CATEGORIES = [
  "PRIMARY",
  "SOCIAL",
  "PROMOTIONS",
  "NEWSLETTERS",
  "TRANSACTIONS",
  "UPDATES",
] as const;

export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

export const AUTO_FILTERS = [
  {
    id: "BILLING",
    label: "Billing",
    description: "Invoices, receipts, payments and subscription charges",
  },
  {
    id: "MARKETING",
    label: "Marketing",
    description: "Promotions, sales, coupons and product offers",
  },
  {
    id: "SECURITY",
    label: "Security",
    description: "Sign-in alerts, verification codes and password changes",
  },
  {
    id: "SHIPPING",
    label: "Shipping",
    description: "Shipments, tracking updates and delivery notices",
  },
  {
    id: "TRAVEL",
    label: "Travel",
    description: "Flights, hotels, reservations and itineraries",
  },
  {
    id: "NEWSLETTERS",
    label: "Newsletters",
    description: "Digests, weekly roundups and mailing-list issues",
  },
  {
    id: "SOCIAL",
    label: "Social",
    description: "Social networks, followers and community notifications",
  },
  {
    id: "NOTIFICATIONS",
    label: "Notifications",
    description: "App alerts, reminders, mentions and build/task updates",
  },
] as const;

export type AutoFilterId = (typeof AUTO_FILTERS)[number]["id"];

export const AUTO_FILTER_IDS = AUTO_FILTERS.map((filter) => filter.id);

export interface ClassificationInput {
  fromAddress?: string | null;
  fromName?: string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  attachmentNames?: string[];
}

export interface ClassificationResult {
  /** Broad Gmail-style tab used by the category row. */
  category: MessageCategory;
  /** Every automatic filter that matched. */
  categories: AutoFilterId[];
  /** Raw rule scores, useful for debugging and tests. */
  scores: Partial<Record<AutoFilterId, number>>;
}

interface FilterRule {
  strong: RegExp[];
  weak: RegExp[];
  domains?: RegExp[];
}

const RULES: Record<AutoFilterId, FilterRule> = {
  BILLING: {
    strong: [
      /\b(?:tax )?invoice\b[\s\S]{0,80}\b(?:due|paid|payment|total|amount|balance)\b/,
      /\b(?:receipt|payment received|payment confirmation|order confirmation|purchase confirmation|booking confirmation)\b/,
      /\b(?:amount|balance|total) due\b/,
      /\b(?:past due|overdue|payment failed|payment declined)\b/,
      /\b(?:refund (?:issued|processed|completed)|chargeback|credit note)\b/,
      /\b(?:subscription|membership) (?:renewed|renewal|expires|expiring|payment|charge)\b/,
      /\b(?:billing|account|credit card) statement\b/,
      /\b(?:charged|debited|withdrawn)\b[\s\S]{0,60}\b(?:account|card|invoice)\b/,
    ],
    weak: [
      /\bbilling\b/,
      /\binvoice\b/,
      /\breceipt\b/,
      /\bpayment\b/,
      /\b(?:order|purchase) (?:#|number|no\.?)\b/,
      /\btransactions?\b/,
      /\brefund\b/,
      /\bsubscription\b/,
      /\brenewal\b/,
      /\bpaypal\b/,
      /\bstripe\b/,
      /\bamount\b/,
    ],
    domains: [
      /(?:^|\.)paypal\.com$/,
      /(?:^|\.)stripe\.com$/,
      /(?:^|\.)wise\.com$/,
      /(?:^|\.)squareup\.com$/,
      /(?:^|\.)intuit\.com$/,
    ],
  },
  MARKETING: {
    strong: [
      /(?:\d{1,2}%|percent)\s+off\b/,
      /\bsave (?:up to )?\d+%/,
      /\b(?:limited[- ]time|flash|doorbuster|clearance|black friday|cyber monday|prime day) (?:sale|offer|deal|pricing)\b/,
      /\b(?:special|exclusive|final|introductory) offer\b/,
      /\bdeal of the day\b/,
      /\b(?:shop|buy|order) now\b/,
      /\bfree shipping\b/,
      /\b(?:new arrivals|best sellers|back in stock|last chance)\b/,
      /\bunsubscribe from (?:marketing|promotions|commercial emails)\b/,
    ],
    weak: [
      /\bpromo(?:tion)?\b/,
      /\bdiscount\b/,
      /\bcoupon\b/,
      /\b(?:sale|deal|offer)\b/,
      /\bmarketing\b/,
    ],
    domains: [
      /(?:^|\.)mailchimp\.com$/,
      /(?:^|\.)sendgrid\.net$/,
      /(?:^|\.)klaviyo\.com$/,
      /(?:^|\.)hubspotemail\.com$/,
      /(?:^|\.)constantcontact\.com$/,
      /(?:^|\.)campaign-archive\.com$/,
    ],
  },
  SECURITY: {
    strong: [
      /\bsecurity alert\b/,
      /\b(?:password|passkey) (?:was |has been )?(?:reset|changed|updated|created)\b/,
      /\b(?:verify|confirm) your (?:email|identity|account|sign-in)\b/,
      /\b(?:verification|security|one[- ]time) code\b/,
      /\b(?:two[- ]factor|2fa|mfa) (?:code|authentication|enabled|disabled)\b/,
      /\bnew (?:sign-in|login|device|browser)\b/,
      /\b(?:suspicious|unusual) (?:activity|login|sign-in|device)\b/,
      /\b(?:account|access) (?:locked|suspended|disabled|restricted)\b/,
      /\b(?:sign-in|login) attempt\b/,
    ],
    weak: [
      /\bsecurity\b/,
      /\bverif(?:y|ication)\b/,
      /\bpassword\b/,
      /\bsign[- ]in\b/,
      /\bpasskey\b/,
    ],
  },
  SHIPPING: {
    strong: [
      /\bout for delivery\b/,
      /\btracking (?:number|code|link|details)\b/,
      /\b(?:has|have) (?:been )?shipped\b/,
      /\bshipment (?:confirmation|update|notification|details)\b/,
      /\b(?:package|parcel) (?:has been|is|was|will be) (?:delivered|shipped|dispatched|on its way)\b/,
      /\b(?:arriving|delivery) (?:today|tomorrow|soon|scheduled)\b/,
      /\b(?:delivered|dispatched) (?:to|by|on)\b/,
      /\b(?:carrier|tracking) (?:is|number|details)\b/,
    ],
    weak: [
      /\bshipping\b/,
      /\bdelivery\b/,
      /\bshipment\b/,
      /\btracking\b/,
      /\bparcel\b/,
      /\bcarrier\b/,
    ],
  },
  TRAVEL: {
    strong: [
      /\bboarding pass\b/,
      /\b(?:flight|trip) (?:confirmation|itinerary|details|number)\b/,
      /\bitinerary\b/,
      /\bhotel (?:reservation|booking|confirmation)\b/,
      /\b(?:rental car|car rental) (?:confirmation|reservation|booking)\b/,
      /\bcheck[- ]in (?:is )?(?:open|available|reminder|time)\b/,
      /\b(?:reservation|booking) confirmation\b/,
    ],
    weak: [
      /\bflight\b/,
      /\btravel\b/,
      /\bhotel\b/,
      /\bbooking\b/,
      /\breservation\b/,
      /\bitinerary\b/,
      /\bairline\b/,
      /\btrain ticket\b/,
    ],
  },
  NEWSLETTERS: {
    strong: [
      /\bnewsletter\b/,
      /\b(?:weekly|monthly|daily) (?:digest|roundup|briefing|update)\b/,
      /\bissue (?:#|no\.? ?)\d+\b/,
      /\bview (?:this|the) (?:email|message|newsletter) in (?:your|a) browser\b/,
      /\byou(?:'re| are) receiving this (?:email|newsletter|message)\b/,
      /\bunsubscribe (?:from this|here|now)\b/,
    ],
    weak: [
      /\bdigest\b/,
      /\broundup\b/,
      /\bweekly\b/,
      /\bmonthly\b/,
      /\bmailing list\b/,
    ],
  },
  SOCIAL: {
    strong: [
      /\b(?:friend|connection) request\b/,
      /\b(?:started following|followed) you\b/,
      /\bmentioned you (?:in|on)\b/,
      /\btagged you (?:in|on)\b/,
      /\bnew follower\b/,
      /\b(?:commented|replied) on your (?:post|photo|update)\b/,
    ],
    weak: [
      /\bsocial\b/,
      /\bfollower\b/,
      /\bprofile\b/,
      /\bcommunity\b/,
      /\bposted\b/,
    ],
    domains: [
      /(?:^|\.)facebook(?:mail)?\.com$/,
      /(?:^|\.)instagram\.com$/,
      /(?:^|\.)linkedin\.com$/,
      /(?:^|\.)twitter\.com$/,
      /(?:^|\.)x\.com$/,
      /(?:^|\.)tiktok\.com$/,
      /(?:^|\.)discord(?:app)?\.com$/,
      /(?:^|\.)reddit(?:mail)?\.com$/,
      /(?:^|\.)pinterest\.com$/,
      /(?:^|\.)snapchat\.com$/,
    ],
  },
  NOTIFICATIONS: {
    strong: [
      /\bnew notification\b/,
      /\byou have \d+ new (?:notifications?|messages?|alerts?)\b/,
      /\bmentioned you (?:in|on)\b/,
      /\b(?:commented|replied) on\b/,
      /\bassigned (?:you|this|the task) to you\b/,
      /\bpull request\b/,
      /\bbuild (?:failed|passed|succeeded|broken)\b/,
      /\b(?:calendar|event|task|payment) reminder\b/,
      /\breminder:\s/,
      /\btask (?:is )?due\b/,
      /\b(?:deploy|deployment) (?:failed|succeeded|completed)\b/,
    ],
    weak: [
      /\bnotification\b/,
      /\breminder\b/,
      /\balert\b/,
      /\bactivity\b/,
      /\bmentioned\b/,
      /\bcommented\b/,
    ],
  },
};

const CATEGORY_WEIGHTS: Record<AutoFilterId, Partial<Record<MessageCategory, number>>> = {
  BILLING: { TRANSACTIONS: 3 },
  MARKETING: { PROMOTIONS: 3 },
  SECURITY: { UPDATES: 3 },
  SHIPPING: { TRANSACTIONS: 2 },
  TRAVEL: { UPDATES: 2, TRANSACTIONS: 1 },
  NEWSLETTERS: { NEWSLETTERS: 2 },
  SOCIAL: { SOCIAL: 3 },
  NOTIFICATIONS: { UPDATES: 2 },
};

const CATEGORY_PRIORITY: MessageCategory[] = [
  "TRANSACTIONS",
  "PROMOTIONS",
  "SOCIAL",
  "NEWSLETTERS",
  "UPDATES",
  "PRIMARY",
];

function domainFrom(value: string): string {
  const at = value.lastIndexOf("@");
  return (at === -1 ? value : value.slice(at + 1)).trim().toLowerCase();
}

function plainText(html: string): string {
  return html
    .replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function countMatches(patterns: RegExp[], haystack: string): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(haystack)) count += 1;
  }
  return count;
}

/**
 * Classify a message into the broad category tabs and the more specific
 * built-in filters. All inputs are optional because older ciphertext cannot be
 * inspected by the server; the client can pass a decrypted preview instead.
 */
export function classifyMessage(input: ClassificationInput): ClassificationResult {
  const subject = (input.subject || "").slice(0, 4_000);
  const body = (input.text || plainText(input.html || "")).slice(0, 80_000);
  const fromName = (input.fromName || "").slice(0, 500);
  const fromAddress = (input.fromAddress || "").toLowerCase();
  const domain = domainFrom(fromAddress);
  const attachments = (input.attachmentNames || []).join(" ").toLowerCase();
  const haystack = `${fromName}\n${fromAddress}\n${subject}\n${body}\n${attachments}`.toLowerCase();

  const scores: Partial<Record<AutoFilterId, number>> = {};
  const categoryScores: Partial<Record<MessageCategory, number>> = {};

  for (const [id, rule] of Object.entries(RULES) as Array<[AutoFilterId, FilterRule]>) {
    let score = 0;
    score += countMatches(rule.strong, haystack) * 2;
    score += countMatches(rule.weak, haystack);
    if (domain && rule.domains?.some((pattern) => pattern.test(domain))) score += 2;
    if (score <= 0) continue;
    scores[id] = score;
    if (score < 2) continue;
    for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS[id]) as Array<
      [MessageCategory, number]
    >) {
      categoryScores[category] = (categoryScores[category] || 0) + weight * Math.min(score, 6);
    }
  }

  const categories = (Object.entries(scores) as Array<[AutoFilterId, number]>)
    .filter(([, score]) => score >= 2)
    .sort((left, right) => right[1] - left[1])
    .map(([id]) => id);

  let category: MessageCategory = "PRIMARY";
  let best = 0;
  for (const candidate of CATEGORY_PRIORITY) {
    const value = categoryScores[candidate] || 0;
    if (value > best) {
      best = value;
      category = candidate;
    }
  }

  return { category, categories, scores };
}

export function isAutoFilterId(value: unknown): value is AutoFilterId {
  return typeof value === "string" && (AUTO_FILTER_IDS as string[]).includes(value);
}

export function isMessageCategory(value: unknown): value is MessageCategory {
  return (
    typeof value === "string" && (MESSAGE_CATEGORIES as readonly string[]).includes(value)
  );
}
