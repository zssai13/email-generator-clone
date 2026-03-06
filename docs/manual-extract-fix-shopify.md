# Manual Extraction Fix: Shopify & PageFly Compatibility

**Date**: March 6, 2026
**File Modified**: `app/api/generate-template/route.js` — `extractProductDataManual()` function
**Affects**: All Manual Extract pipelines (Mini, Sonnet 4.5, Haiku 4.5)
**Deployment**: No env var changes needed — code-only update

---

## Bug Report

**URL**: `https://getmatter.co/products/blood-flow` (Shopify + PageFly page builder)

The Manual Extract pipelines generated bad emails for this product page:

| Field | Expected | Actual (before fix) |
|-------|----------|---------------------|
| Hero Image | Product bottle (`Heart_Beets_Main_Image.jpg` from Shopify CDN) | Anatomical heart line drawing from `markethero-cdn-prod.s3.amazonaws.com` |
| Price | £24.99 | *(empty string)* |
| Hero Image Count | 1+ | **0** |
| Total Images | 5 product photos | 15 (mostly icons/decorative PNGs) |

The Cheerio extraction found 15 images but classified **zero** as hero/main images. GPT-4o Mini refinement then picked the wrong image from 15 bad candidates since it can only see URLs, not actual image content.

---

## Root Cause Analysis

Five specific failures in the old `extractProductDataManual()`:

### 1. No `og:image` extraction
The page has `<meta property="og:image" content="...Heart_Beets_Main_Image_grande.jpg">` — the perfect hero product photo. Every Shopify store sets this. **The old code never checked `og:image` for images.**

### 2. No JSON-LD structured data parsing
The page contains `<script type="application/ld+json">` with:
- Product name: "Heart Beets"
- Price variants: £24.99, £16.66, £14.99
- Aggregate rating: 4.8 stars (1,977 reviews)
- Product images

**The old code ignored all of this structured data.**

### 3. CSS selectors missed PageFly themes
The page uses PageFly builder (`class="__pf"`) with custom class names like `pf-heading`, `pf-text`. None of the old hero selectors (`.hero img`, `.product__media img`, etc.) matched. Result: `hero_images: 0`.

### 4. Protocol-relative URLs filtered out
All product images on this page use protocol-relative URLs (`//getmatter.co/cdn/shop/files/...`). The general fallback check `src.startsWith('http')` filtered these out, leaving only tracking/analytics images that happened to use absolute URLs.

### 5. No domain-level filtering
The `markethero-cdn-prod.s3.amazonaws.com` tracking pixel image passed all filters. There was no blocklist for known non-product image domains.

---

## What Changed

### Fix 1: JSON-LD Structured Data Parsing (NEW)

Added parsing of `<script type="application/ld+json">` blocks to extract Product schema data. Handles:
- Direct `{"@type": "Product"}` objects
- Array-wrapped schemas
- Shopify `@graph` arrays

Used as the primary source for **title**, **price**, **description**, and **images** before falling back to CSS selectors.

### Fix 2: Priority 0 Image Sources — `og:image` + JSON-LD (NEW)

Added a new highest-priority tier (Priority 0) above the existing hero selectors:

| Priority | Source | Confidence |
|----------|--------|------------|
| **0 (NEW)** | `og:image` meta tag | Highest — platform always sets this to main product image |
| **0 (NEW)** | JSON-LD `image` field | Highest — structured data confirmed product image |
| 1 | Hero/main CSS selectors + Shopify CDN | High |
| 2 | Product section CSS selectors | Medium |
| 3 | General `img` fallback | Low |

### Fix 3: Shopify CDN Detection (NEW)

Added 6 new Priority 1 selectors that match Shopify CDN image URLs regardless of page theme:

```
img[src*="cdn.shopify.com/s/files"]
img[src*="/cdn/shop/files"]
img[data-src*="cdn.shopify.com/s/files"]
img[data-src*="/cdn/shop/files"]
img[srcset*="cdn.shopify.com"]
img[srcset*="/cdn/shop/"]
```

Also added automatic priority boost: any image from a Shopify CDN path gets promoted to Priority 1 even if found via a lower-priority selector.

### Fix 4: Price Extraction Overhaul (IMPROVED)

New cascading price extraction:

```
1. JSON-LD offers.price / offers.lowPrice  (most reliable)
2. Shopify inline JSON "price": 2499        (cents → dollars)
3. CSS selectors (.price, [data-price], etc.)
4. og:price meta tags                       (last resort)
```

Also improved CSS price parsing to handle currency symbols (`£24.99`, `$29.99`, `€19.99`).

### Fix 5: Non-Product Domain Blocklist (NEW)

Images from these domains are now filtered out:

```
markethero-cdn, google-analytics, facebook.com, doubleclick,
googletagmanager, pixel, tracking, analytics, beacon,
fonts.googleapis, gravatar, wp-content/plugins
```

Additional URL-pattern filters added: `.svg`, `payment`, `trust-seal`, `spinner`, `placeholder`, `badge`.

### Fix 6: URL Normalization + Tiny Image Filtering (IMPROVED)

- **URL normalization**: Strips query params for deduplication (same image at different sizes no longer counted twice)
- **Protocol-relative URL support**: `//domain.com/...` URLs now handled correctly throughout the pipeline
- **Tiny image filter**: Images under 50px in either dimension (icons/decorations) are skipped
- **srcset parsing**: If no `src`/`data-src` found, extracts first URL from `srcset` attribute

---

## Before vs After — getmatter.co/products/blood-flow

| Metric | Before | After (expected) |
|--------|--------|-------------------|
| Title | "Heart Beets" | "Heart Beets" (unchanged) |
| Price | *(empty)* | "GBP 24.99" or "24.99" |
| og:image found | No | Yes — `Heart_Beets_Main_Image_grande.jpg` |
| JSON-LD parsed | No | Yes — title, price, rating |
| Hero images (P0+P1) | 0 | 5+ (og:image + Shopify CDN images) |
| Shopify CDN images | 0 (filtered out) | 5 (`Heart_Beets_*.jpg`) |
| Non-product images | 15 (including tracking pixels) | Filtered out |

---

## Affected Pipelines

All three Manual Extract pipelines share `extractProductDataManual()`:

| Pipeline | Refine/Generate Model | Affected |
|----------|----------------------|----------|
| Manual Extract + Mini Refine + Generate | GPT-4o Mini | Yes |
| Manual Extract + Sonnet 4.5 Refine + Generate | Claude Sonnet 4.5 | Yes |
| Manual Extract + Haiku 4.5 Refine + Generate | Claude Haiku 4.5 | Yes |

The AI refinement prompts were also updated to understand Priority 0 images:
- `HIGHEST PRIORITY (og:image or JSON-LD - confirmed main product image)` — always use first
- `HIGH PRIORITY (hero/main/Shopify-CDN selector)` — use as secondary images

---

## Deployment

1. Push latest code to main branch
2. Deploy to Vercel: `vercel --prod`
3. No environment variable changes required
4. Test with `https://getmatter.co/products/blood-flow` on Tab 2 using any Manual Extract pipeline
5. Verify console logs show: `og_jsonld_images: 1+`, `hero_images: 5+`, `json_ld_found: true`, `price: "GBP 24.99"` (or similar)
