'use strict';

/**
 * Server-side HTML sanitization for article content.
 * Editorial markup allowlist — strips scripts, event handlers,
 * javascript: URLs, styles, and unknown embeds.
 */
const sanitizeHtml = require('sanitize-html');

/**
 * Pre-strip dangerous block elements AND their contents before allowlist
 * sanitization. sanitize-html alone would either escape the body (ugly text
 * leaking into the article) or, in discard mode, keep it as plain text.
 * These tags have no legitimate editorial use in article bodies.
 */
const BLOCK_TAG_RE = /<(script|style|noscript|template|object|embed|form|base)[^>]*>[\s\S]*?<\/\1\s*>/gi;
const SELF_CLOSING_RE = /<(script|style|noscript|template|object|embed|form|base)[^>]*\/?\s*>/gi;

function preStrip(html) {
  return String(html ?? '')
    .replace(BLOCK_TAG_RE, '')
    .replace(SELF_CLOSING_RE, '');
}

const ARTICLE_SANITIZER = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'i', 'u', 'a',
    'ul', 'ol', 'li',
    'h2', 'h3', 'h4',
    'blockquote', 'figure', 'figcaption', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    // Explicitly allowlisted embeds (YouTube / Vimeo only, when needed)
    'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder', 'title'],
    '*': ['class'],
  },
  allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'player.vimeo.com'],
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
    img: ['http', 'https', 'data:image/png', 'data:image/jpeg', 'data:image/webp'],
  },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  selfClosing: ['img', 'br'],
  nonTextTags: ['img', 'iframe'],
  // Discard disallowed tags AND their contents (script/style bodies must not
  // leak as plain text).
  disallowedTagsMode: 'discard',
  exclusiveFilter: (frame) => {
    // Drop iframes that are not youtube/vimeo (defense in depth beyond hostname allowlist)
    if (frame.tag === 'iframe') {
      const src = (frame.attribs && frame.attribs.src) || '';
      if (!/^(https:\/\/)?(www\.)?(youtube\.com|player\.vimeo\.com)\//.test(src)) {
        return true; // drop
      }
    }
    return false;
  },
};

function sanitizeArticleHtml(html) {
  return sanitizeHtml(preStrip(html), ARTICLE_SANITIZER).trim();
}

/** Plain-text extraction (for word counts / search indexing). */
function stripHtml(html) {
  return sanitizeHtml(String(html ?? ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(html) {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(' ').length;
}

module.exports = { sanitizeArticleHtml, stripHtml, wordCount };
