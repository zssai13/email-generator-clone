# Smart Fetch: Technical Guide

How Tab 1's Smart Fetch pre-extraction system works, and how to replicate it.

**File**: `app/api/generate/route.js` (lines 1-336)
**Frontend**: `app/page.jsx` (fetchMethod state + dropdown)
**Dependency**: `cheerio` (already in package.json)

---

## 1. Architecture

```
USER CLICKS "GENERATE"
         │
         ▼
┌─────────────────────────────┐
│  Frontend (page.jsx)        │
│  Sends: productUrl,         │
│         fetchMethod,        │  fetchMethod = "standard" | "smart"
│         customPrompt        │
└─────────────┬───────────────┘
              │ POST /api/generate
              ▼
┌─────────────────────────────┐
│  API Route (route.js)       │
│  Builds prompt for Claude   │
│  If smart: adds instruction │
│  to use pre-extracted data  │
└─────────────┬───────────────┘
              │ Claude Opus 4.5 called
              ▼
┌─────────────────────────────┐
│  Claude requests fetch_url  │
│  (tool use)                 │
└─────────────┬───────────────┘
              │
              ▼
┌──────────────────────────────────────────────┐
│  executeTool("fetch_url", input, fetchMethod)│
│                                              │
│  1. HTTP fetch → full HTML (e.g. 1.1MB)     │
│                                              │
│  ┌─────────────┐    ┌─────────────────────┐  │
│  │  STANDARD   │    │    SMART FETCH      │  │
│  │             │    │                     │  │
│  │ html.sub-   │    │ Cheerio loads FULL  │  │
│  │ string(0,   │    │ 1.1MB HTML          │  │
│  │ 100000)     │    │         │           │  │
│  │             │    │         ▼           │  │
│  │ Returns     │    │ preExtractProduct   │  │
│  │ truncated   │    │ Data(html, url)     │  │
│  │ HTML only   │    │         │           │  │
│  │             │    │    Extracts:        │  │
│  │             │    │    - Logo URL       │  │
│  │             │    │    - Product images │  │
│  │             │    │    - Title          │  │
│  │             │    │    - Price          │  │
│  │             │    │    - Description    │  │
│  │             │    │    - JSON-LD        │  │
│  │             │    │    - Shopify JSON   │  │
│  │             │    │    - Meta tags      │  │
│  │             │    │         │           │  │
│  │             │    │         ▼           │  │
│  │             │    │ formatExtractedData │  │
│  │             │    │         │           │  │
│  │             │    │         ▼           │  │
│  │             │    │ PREPEND extracted   │  │
│  │             │    │ data + truncated    │  │
│  │             │    │ HTML (100KB)        │  │
│  └──────┬──────┘    └────────┬────────────┘  │
│         │                    │               │
└─────────┼────────────────────┼───────────────┘
          │                    │
          ▼                    ▼
┌─────────────────────────────────────────┐
│  Claude receives tool result            │
│                                         │
│  Standard: just truncated HTML          │
│  Smart: extracted data + truncated HTML │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Claude generates HTML email            │
│  Smart: uses real logo, CDN images,     │
│         accurate product details        │
└─────────────────────────────────────────┘
```

---

## 2. The Problem

Ecommerce pages (especially Shopify) are large. A typical product page:

| Site Type | Page Size | After 100KB Truncation |
|-----------|-----------|----------------------|
| Shopify | 800KB - 1.5MB | 7-12% of page |
| WooCommerce | 200KB - 600KB | 17-50% of page |
| BigCommerce | 300KB - 800KB | 12-33% of page |

On Shopify, the first 100KB is mostly:
- Boilerplate HTML/CSS
- Navigation markup
- Theme JavaScript references

The critical data lives **after** 100KB:
- `<script type="application/ld+json">` (structured product data)
- Product gallery image URLs (CDN paths like `cdn/shop/files/...`)
- Shopify product JSON embedded in `<script>` tags
- Logo image URL
- Full product descriptions

**Result**: Claude only sees page structure but not the actual product data, so it generates generic emails with placeholder-style content.

---

## 3. Standard vs Smart: Side-by-Side

### Standard Method
```
Full HTML (1.1MB)
    │
    ▼
html.substring(0, 100000)  ← hard truncation
    │
    ▼
Claude gets 100KB of HTML  ← missing images, logo, product data
    │
    ▼
Generic email output
```

### Smart Fetch Method
```
Full HTML (1.1MB)
    │
    ├──► Cheerio parses FULL HTML ──► Extracts logo, images, title,
    │                                  price, description, JSON-LD,
    │                                  Shopify JSON, meta tags
    │
    ├──► html.substring(0, 100000) ──► Still get page structure
    │
    ▼
Extracted data block + truncated HTML combined
    │
    ▼
Claude gets: guaranteed product data + page structure
    │
    ▼
Email with real brand logo, real CDN images, accurate details
```

---

## 4. Complete Code Reference

### 4A. URL Resolution Helper

```javascript
// app/api/generate/route.js — line 25

function toAbsoluteUrl(src, baseUrl) {
  if (!src) return null;
  try {
    if (src.startsWith('//')) return 'https:' + src;  // Protocol-relative
    if (src.startsWith('http')) return src;            // Already absolute
    return new URL(src, baseUrl).href;                 // Relative → absolute
  } catch {
    return null;
  }
}
```

Used by every image extraction step to normalize URLs before giving them to Claude.

---

### 4B. Pre-Extraction Function

This is the core of Smart Fetch. It receives the **full** HTML (before any truncation) and extracts all critical product data using Cheerio CSS selectors.

```javascript
// app/api/generate/route.js — line 37

import * as cheerio from 'cheerio';

function preExtractProductData(html, url) {
  const $ = cheerio.load(html);
  const data = {
    logo: null,
    title: null,
    price: null,
    description: null,
    images: [],
    structuredData: null,
    metaTags: {}
  };
```

#### Step 1: Meta Tags (fastest, most reliable)

```javascript
  // --- META TAGS ---
  data.metaTags.ogImage = $('meta[property="og:image"]').attr('content') || null;
  data.metaTags.ogTitle = $('meta[property="og:title"]').attr('content') || null;
  data.metaTags.ogDescription = $('meta[property="og:description"]').attr('content') || null;
```

#### Step 2: Logo (inverted from Tab 2 — we WANT logos)

```javascript
  // --- LOGO ---
  const logoSelectors = [
    'img[src*="logo" i]',        // src contains "logo" (case insensitive)
    'img[alt*="logo" i]',        // alt contains "logo"
    'img[class*="logo" i]',      // class contains "logo"
    'header img',                 // first image in <header>
    'nav img',                    // first image in <nav>
    '#header img',                // common ID pattern
    '.header img',                // common class pattern
    '.site-header img',           // Shopify theme pattern
    '.navbar-brand img',          // Bootstrap pattern
    'link[rel="icon"]',           // favicon as fallback
    'link[rel="shortcut icon"]'   // legacy favicon
  ];
  for (const sel of logoSelectors) {
    const el = $(sel).first();
    if (el.length) {
      const src = el.attr('src') || el.attr('href');
      const resolved = toAbsoluteUrl(src, url);
      if (resolved) {
        data.logo = resolved;
        break;                    // First match wins
      }
    }
  }
```

#### Step 3: Product Title

```javascript
  // --- TITLE ---
  const titleSelectors = [
    'h1.product-title',           // Shopify themes
    'h1[data-product-title]',     // data attribute pattern
    '.product-title h1',          // nested pattern
    'h1'                          // generic fallback
  ];
  for (const sel of titleSelectors) {
    const text = $(sel).first().text().trim();
    if (text) { data.title = text; break; }
  }
  // Meta tag fallback
  if (!data.title) {
    data.title = data.metaTags.ogTitle || $('title').text().trim() || null;
  }
```

#### Step 4: Product Price

```javascript
  // --- PRICE ---
  const priceSelectors = [
    '.price',                     // Most common
    '.product-price',             // Shopify
    '[data-price]',               // Data attribute
    '.price-current',             // Sale price pattern
    '.sale-price',
    '[itemprop="price"]',         // Schema.org
    '.cost',
    '.amount'
  ];
  for (const sel of priceSelectors) {
    const el = $(sel).first();
    const text = el.text().trim();
    if (text && /\d/.test(text)) {
      // Extract price-like value (e.g., "$98.00" from "Regular price $98.00")
      const match = text.match(/[\$\£\€]?\s*[\d,]+\.?\d*/);
      data.price = match ? match[0].trim() : text;
      break;
    }
    // Check data attributes as fallback
    const dataPrice = el.attr('data-price') || el.attr('content');
    if (dataPrice) { data.price = '$' + dataPrice; break; }
  }
```

#### Step 5: Product Description

```javascript
  // --- DESCRIPTION ---
  const descSelectors = [
    '.product-description',
    '.description',
    '[data-product-description]',
    '.product-details',
    '.product-info',
    '[itemprop="description"]'
  ];
  for (const sel of descSelectors) {
    const text = $(sel).first().text().trim();
    if (text && text.length > 20) {        // Skip empty/tiny matches
      data.description = text.substring(0, 500);  // Cap at 500 chars
      break;
    }
  }
  if (!data.description) {
    data.description = data.metaTags.ogDescription
      || $('meta[name="description"]').attr('content') || null;
  }
```

#### Step 6: Product Images (Priority System)

```javascript
  // --- PRODUCT IMAGES ---
  const seenUrls = new Set();                // Deduplicate
  const addImage = (src, priority) => {
    const resolved = toAbsoluteUrl(src, url);
    if (!resolved || seenUrls.has(resolved)) return;
    // Filter out non-product images
    const lower = resolved.toLowerCase();
    if (lower.includes('pixel') || lower.includes('tracking') ||
        lower.includes('spacer')) return;
    if (lower.includes('badge') || lower.includes('flag') ||
        lower.includes('avatar')) return;
    seenUrls.add(resolved);
    data.images.push({ url: resolved, priority });
  };

  // Priority 1: Hero/Main product images
  const p1Selectors = [
    '.hero img', '.product-hero img', '.main-image',
    'img[data-main-image]', 'img[data-product-image="main"]',
    '.product__media img',              // Shopify Dawn theme
    '.product-single__media img',       // Shopify Debut theme
    '.woocommerce-product-gallery img'  // WooCommerce
  ];
  for (const sel of p1Selectors) {
    $(sel).each((_, el) => {
      const src = $(el).attr('src')
        || $(el).attr('data-src')
        || $(el).attr('data-srcset')?.split(' ')[0];
      if (src) addImage(src, 1);
    });
  }

  // Priority 2: Product gallery images
  const p2Selectors = [
    'img.product-image', 'img[data-product-image]',
    '.product-images img', '.product-gallery img',
    'img[src*="product"]', 'img.primary-image'
  ];
  for (const sel of p2Selectors) {
    $(sel).each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) addImage(src, 2);
    });
  }

  // OG image as fallback (always priority 1)
  if (data.metaTags.ogImage) {
    addImage(data.metaTags.ogImage, 1);
  }
```

#### Step 7: JSON-LD Structured Data (Most Reliable Source)

```javascript
  // --- STRUCTURED DATA (JSON-LD) ---
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type']?.includes('Product')) {
          data.structuredData = {
            name: item.name,
            description: item.description?.substring(0, 300),
            price: item.offers?.price || item.offers?.[0]?.price,
            currency: item.offers?.priceCurrency || item.offers?.[0]?.priceCurrency,
            images: Array.isArray(item.image) ? item.image : (item.image ? [item.image] : []),
            brand: item.brand?.name || item.brand
          };
          // Add structured data images as high priority
          for (const img of data.structuredData.images) {
            addImage(img, 1);
          }
          // Fill in missing fields from structured data
          if (!data.title && data.structuredData.name) data.title = data.structuredData.name;
          if (!data.price && data.structuredData.price) {
            const curr = data.structuredData.currency === 'USD' ? '$'
              : (data.structuredData.currency || '$');
            data.price = curr + data.structuredData.price;
          }
          if (!data.description && data.structuredData.description) {
            data.description = data.structuredData.description;
          }
          break;
        }
      }
    } catch { /* ignore parse errors */ }
  });
```

**Why JSON-LD is the most valuable target**: Shopify always generates a `<script type="application/ld+json">` block with accurate product name, price, description, and image URLs. It's machine-readable by design and always contains the canonical data.

#### Step 8: Shopify Product JSON

```javascript
  // --- SHOPIFY PRODUCT JSON ---
  // Pattern 1: Inline script with product/variants data
  $('script').each((_, el) => {
    const scriptContent = $(el).html() || '';
    if (scriptContent.includes('"product"') && scriptContent.includes('"variants"')) {
      try {
        const patterns = [
          /var\s+meta\s*=\s*(\{[\s\S]*?"product"[\s\S]*?\});/,
          /"product"\s*:\s*(\{[\s\S]*?"variants"[\s\S]*?\})\s*[,}]/
        ];
        for (const pattern of patterns) {
          const match = scriptContent.match(pattern);
          if (match) {
            const parsed = JSON.parse(match[1]);
            const product = parsed.product || parsed;
            if (product.featured_image) addImage(product.featured_image, 1);
            if (product.images) {
              for (const img of product.images.slice(0, 5)) {
                addImage(typeof img === 'string' ? img : img.src, 1);
              }
            }
            break;
          }
        }
      } catch { /* ignore parse errors */ }
    }
  });

  // Pattern 2: Dedicated product JSON script tags
  $('script[data-product-json], script[type="application/json"][data-product]').each((_, el) => {
    try {
      const product = JSON.parse($(el).html());
      if (product.featured_image) addImage(product.featured_image, 1);
      if (product.images) {
        for (const img of product.images.slice(0, 5)) {
          addImage(typeof img === 'string' ? img : img.src, 1);
        }
      }
    } catch { /* ignore */ }
  });
```

#### Final: Sort and Cap Images

```javascript
  // Sort images: priority 1 first, then priority 2. Keep top 5.
  data.images.sort((a, b) => a.priority - b.priority);
  data.images = data.images.slice(0, 5);

  return data;
}
```

---

### 4C. Format Extracted Data for Claude

This turns the extracted data object into a plain text block that gets prepended to the tool result Claude receives.

```javascript
// app/api/generate/route.js — line 247

function formatExtractedData(data) {
  let output = '--- PRE-EXTRACTED PRODUCT DATA ---\n';
  output += 'IMPORTANT: Use this extracted data for accurate product information, images, and branding.\n\n';

  if (data.logo) output += `Logo URL: ${data.logo}\n`;
  if (data.title) output += `Product Title: ${data.title}\n`;
  if (data.price) output += `Product Price: ${data.price}\n`;
  if (data.description) output += `Product Description: ${data.description}\n`;

  if (data.images.length > 0) {
    output += `\nProduct Images (${data.images.length} found):\n`;
    data.images.forEach((img, i) => {
      output += `  ${i + 1}. ${img.url}${img.priority === 1 ? ' (hero/main)' : ''}\n`;
    });
  }

  if (data.structuredData) {
    output += `\nStructured Data: Found (Product schema`;
    if (data.structuredData.brand) output += `, brand: ${data.structuredData.brand}`;
    if (data.structuredData.images?.length) output += `, ${data.structuredData.images.length} images`;
    output += `)\n`;
  }

  if (data.metaTags.ogImage) output += `OG Image: ${data.metaTags.ogImage}\n`;

  output += '--- END PRE-EXTRACTED DATA ---';
  return output;
}
```

---

### 4D. Format Extracted Data for Diagnostic Log

A more concise format used in the downloadable diagnostic log file.

```javascript
// app/api/generate/route.js — line 277

function formatExtractedDataForLog(data) {
  let output = '--- PRE-EXTRACTED DATA (Smart Fetch) ---\n';
  output += `Logo: ${data.logo || '(not found)'}\n`;
  output += `Title: ${data.title || '(not found)'}\n`;
  output += `Price: ${data.price || '(not found)'}\n`;
  output += `Description: ${data.description ? data.description.substring(0, 100) + '...' : '(not found)'}\n`;
  output += `Images Found: ${data.images.length}\n`;
  data.images.forEach((img, i) => {
    output += `  ${i + 1}. ${img.url}\n`;
  });
  output += `Structured Data (JSON-LD): ${data.structuredData ? 'Yes' : 'No'}\n`;
  output += `OG Image: ${data.metaTags?.ogImage || '(not found)'}\n`;
  return output;
}
```

---

## 5. Extraction Priority System

Each data type has a **selector chain** — an ordered list of CSS selectors tried from most specific to most generic. First match wins.

| Data Type | Priority Order | Fallback |
|-----------|---------------|----------|
| **Logo** | `img[src*="logo"]` → `img[alt*="logo"]` → `header img` → `nav img` → `link[rel="icon"]` | None |
| **Title** | `h1.product-title` → `h1[data-product-title]` → `h1` → `og:title` → `<title>` | JSON-LD name |
| **Price** | `.price` → `.product-price` → `[data-price]` → `[itemprop="price"]` | JSON-LD offers.price |
| **Description** | `.product-description` → `[itemprop="description"]` → `og:description` | JSON-LD description |
| **Images P1** | `.product-hero img` → `img[data-main-image]` → `.product__media img` (Shopify) → `.woocommerce-product-gallery img` | OG image |
| **Images P2** | `img.product-image` → `.product-gallery img` → `img[src*="product"]` | — |
| **Structured Data** | `<script type="application/ld+json">` with `@type: Product` | — |
| **Shopify JSON** | `var meta = {...product...}` → `<script data-product-json>` | — |

**JSON-LD backfills**: If title, price, or description weren't found via CSS selectors, the JSON-LD structured data fills them in. This is the safety net.

**Image deduplication**: A `Set` tracks seen URLs. The same image from different sources (CSS selector, JSON-LD, Shopify JSON, OG tag) only appears once.

---

## 6. What Claude Receives

When Smart Fetch is active, the tool result Claude gets looks like this:

```
--- PRE-EXTRACTED PRODUCT DATA ---
IMPORTANT: Use this extracted data for accurate product information, images, and branding.

Logo URL: https://www.beachbunnyswimwear.com/cdn/shop/files/logo.png?v=1613168468
Product Title: Tessa Tango Bottom - Turquoise/Aqua
Product Price: $98.00
Product Description: Meet the skirt that turns every moment into a runway...

Product Images (5 found):
  1. https://www.beachbunnyswimwear.com/cdn/shop/files/TESSA_TANGO_TUAQ_1.jpg (hero/main)
  2. https://www.beachbunnyswimwear.com/cdn/shop/files/TESSA_TANGO_TUAQ_2.jpg (hero/main)
  3. https://www.beachbunnyswimwear.com/cdn/shop/files/TESSA_TANGO_TUAQ_3.jpg (hero/main)
  4. https://www.beachbunnyswimwear.com/cdn/shop/files/TESSA_TANGO_TUAQ_4.jpg
  5. https://www.beachbunnyswimwear.com/cdn/shop/files/TESSA_TANGO_TUAQ_5.jpg

Structured Data: Found (Product schema, brand: Beach Bunny, 5 images)
OG Image: https://www.beachbunnyswimwear.com/cdn/shop/files/TESSA_TANGO_TUAQ_1.jpg
--- END PRE-EXTRACTED DATA ---

--- PAGE HTML (first 100KB) ---
<!doctype html>
<!-- ... first 100KB of page HTML for structure context ... -->
```

The prompt also includes this instruction when Smart Fetch is active:

```
IMPORTANT: When you fetch the product page, the response will include PRE-EXTRACTED
PRODUCT DATA at the top. Use this data for accurate product images, logo, title,
price, and description. Always use the real logo image URL and real product image
URLs provided.
```

---

## 7. Frontend Integration

### State
```javascript
// app/page.jsx — line 11
const [fetchMethod, setFetchMethod] = useState('standard');
```

### Dropdown UI
```javascript
// app/page.jsx — line 575
<select
  value={fetchMethod}
  onChange={(e) => setFetchMethod(e.target.value)}
>
  <option value="standard">Standard (100KB)</option>
  <option value="smart">Smart Fetch</option>
</select>
```

### API Call
```javascript
// app/page.jsx — line 107
body: JSON.stringify({
  productUrl,
  emailCount,
  promotion,
  customPrompt: customPromptTab1,
  fetchMethod           // ← "standard" or "smart"
})
```

### Backend Routing
```javascript
// app/api/generate/route.js — line 458
const { productUrl, customPrompt, fetchMethod } = await request.json();
const selectedFetchMethod = fetchMethod === 'smart' ? 'smart' : 'standard';

// Passed to executeTool on each tool call:
const { result, diagnostics, extractedData } =
  await executeTool(toolUseBlock.name, toolUseBlock.input, selectedFetchMethod);
```

### executeTool Routing
```javascript
// app/api/generate/route.js — line 311
if (fetchMethod === 'smart') {
  // Run Cheerio extraction on FULL HTML
  extractedData = preExtractProductData(html, toolInput.url);
  const dataContext = formatExtractedData(extractedData);
  const truncatedHtml = html.substring(0, 100000);
  result = dataContext + '\n\n--- PAGE HTML (first 100KB) ---\n' + truncatedHtml;
} else {
  // Standard: truncate only
  result = html.substring(0, 100000);
}
```

---

## 8. Diagnostic Logging

The downloadable `.txt` log file includes Smart Fetch results when that method is selected:

```
========================================
EMAIL GENERATOR - DIAGNOSTIC LOG
========================================
Timestamp: 2026-02-02T16:34:23.592Z
Product URL: https://www.beachbunnyswimwear.com/...
Fetch Method: smart

--- TOOL CALL #1 ---
Tool: fetch_url
Fetch Method: smart
URL Fetched: https://www.beachbunnyswimwear.com/...
HTTP Status: 200
HTML Size: 1,127,115 characters
Truncated: Yes (over 100KB limit)
Smart Fetch Results:
  Logo: found
  Title: Tessa Tango Bottom - Turquoise/Aqua
  Price: $98.00
  Images Found: 5
  Structured Data: found

--- PRE-EXTRACTED DATA (Smart Fetch) ---
Logo: https://www.beachbunnyswimwear.com/cdn/shop/files/logo.png?v=1613168468
Title: Tessa Tango Bottom - Turquoise/Aqua
Price: $98.00
Description: Meet the skirt that turns every moment...
Images Found: 5
  1. https://...TESSA_TANGO_TUAQ_1.jpg
  2. https://...TESSA_TANGO_TUAQ_2.jpg
  ...
Structured Data (JSON-LD): Yes
OG Image: https://...TESSA_TANGO_TUAQ_1.jpg

--- FINAL OUTPUT ---
Generated HTML Length: 25,556 characters
HTML Parse Success: Yes

--- TOKEN USAGE ---
Input Tokens: 48,871
Output Tokens: 8,142
Total: 57,013
========================================
```

---

## 9. Replication Guide

To apply this pattern to another API route or project:

### Step 1: Install Cheerio
```bash
npm install cheerio
```

### Step 2: Add the extraction function

Copy `preExtractProductData()` and `toAbsoluteUrl()` from `app/api/generate/route.js` (lines 25-243). Adjust the CSS selectors for your target site types.

### Step 3: Add the formatter

Copy `formatExtractedData()` (lines 247-274). Adjust the output format to match what your AI model expects.

### Step 4: Wire into your fetch pipeline

Wherever you fetch HTML and truncate it:

```javascript
// Before (loses data):
const result = html.substring(0, 100000);

// After (preserves critical data):
const extractedData = preExtractProductData(html, url);
const dataContext = formatExtractedData(extractedData);
const truncatedHtml = html.substring(0, 100000);
const result = dataContext + '\n\n--- PAGE HTML ---\n' + truncatedHtml;
```

### Step 5: Tell the AI model to use the data

Add to your prompt:
```
When you fetch the product page, the response will include PRE-EXTRACTED PRODUCT
DATA at the top. Use this data for accurate product images, logo, title, price,
and description.
```

### Step 6: Add to your UI (optional)

If you want A/B comparison, add a method selector dropdown that passes `fetchMethod` to your API and routes to standard or smart in the backend.

### Key Customization Points

| What to customize | Where | Why |
|---|---|---|
| CSS selectors | `preExtractProductData()` | Different platforms use different class names |
| Image filter rules | `addImage()` helper | Block/allow different image patterns |
| Priority levels | P1/P2 selector arrays | Adjust hero vs gallery classification |
| Truncation limit | `html.substring(0, N)` | Increase if token budget allows |
| Max images | `.slice(0, 5)` | More images = more tokens |
| Description cap | `.substring(0, 500)` | Longer descriptions = more tokens |

---

## File Reference

| File | Lines | What it does |
|------|-------|-------------|
| `app/api/generate/route.js` | 1-4 | Imports (Anthropic SDK + Cheerio) |
| | 7-22 | Tool definition (fetch_url) |
| | 25-34 | `toAbsoluteUrl()` helper |
| | 37-243 | `preExtractProductData()` — Cheerio extraction |
| | 247-274 | `formatExtractedData()` — text for Claude |
| | 277-290 | `formatExtractedDataForLog()` — text for diagnostic log |
| | 293-336 | `executeTool()` — routes standard vs smart |
| | 441-589 | `POST handler` — orchestrates everything |
| `app/page.jsx` | 11 | `fetchMethod` state |
| | 575-587 | Fetch Method dropdown |
| | 107 | `fetchMethod` sent in API request |
