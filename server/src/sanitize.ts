import DOMPurify from "isomorphic-dompurify";
import { stripHtml, textToHtml } from "@nyxmail/shared";

const ALLOWED_TAGS = [
  "a", "abbr", "address", "article", "aside", "b", "blockquote", "br", "caption",
  "center", "cite", "code", "col", "colgroup", "dd", "del", "details", "div", "dl",
  "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark",
  "ol", "p", "pre", "q", "s", "section", "small", "span", "strike", "strong",
  "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
  "u", "ul",
];

const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "width", "height", "style", "class", "align",
  "valign", "colspan", "rowspan", "border", "cellpadding", "cellspacing", "bgcolor",
  "color", "face", "size", "target", "rel", "id", "dir", "lang", "role", "aria-label",
];

export function sanitizeEmailHtml(input: string): string {
  const sanitized = DOMPurify.sanitize(input || "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "base", "link", "meta", "svg", "math", "video", "audio", "source"],
    FORBID_ATTR: ["srcset", "formaction", "action", "ping", "http-equiv", "contenteditable"],
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    SANITIZE_DOM: true,
  });
  return stripTrackingPixels(sanitized);
}

/**
 * Remove 1x1 images and typical tracking-pixel patterns. Remote image loading
 * is separately controlled by the reading pane.
 */
export function stripTrackingPixels(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const width = /\bwidth\s*=\s*["']?1(?:px)?["']?/i.test(tag);
    const height = /\bheight\s*=\s*["']?1(?:px)?["']?/i.test(tag);
    const style = /\bstyle\s*=\s*["'][^"']*(?:width|height)\s*:\s*1(?:px)?\b[^"']*["']/i.test(tag);
    return width || height || style ? "" : tag;
  });
}

export function normalizeEmailContent(html: string, text: string): { html: string; text: string } {
  const safeText = (text || "").slice(0, 500_000);
  const candidate = html?.trim() ? html : textToHtml(safeText);
  const safeHtml = sanitizeEmailHtml(candidate);
  return {
    html: safeHtml || textToHtml("This message has no displayable content."),
    text: safeText || stripHtml(safeHtml).slice(0, 500_000),
  };
}

export function hasRemoteImages(html: string): boolean {
  return /<img\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(html);
}

export function buildIframeDocument(html: string, allowRemoteImages: boolean, trustedOrigins: string[] = []): string {
  const withoutScripts = sanitizeEmailHtml(html);
  // The client rewrites remote image URLs through the authenticated proxy.
  const imagePolicy = allowRemoteImages
    ? "img-src data: blob: cid: https: http:;"
    : "img-src data: blob: cid:;";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; ${imagePolicy} font-src data:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 15px; line-height: 1.65; color: #1c2230;
    overflow-wrap: anywhere; word-break: break-word;
  }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; }
  a { color: #5b3df5; }
  blockquote { border-left: 3px solid rgba(109,74,255,.35); margin-left: 0; padding-left: 12px; color: #576074; }
  pre { white-space: pre-wrap; }
  @media (prefers-color-scheme: dark) {
    body { color: #E6EAF2; }
    a { color: #A78BFA; }
    blockquote { color: #A6AFC2; }
  }
</style>
</head>
<body>${withoutScripts}</body>
</html>`;
}
