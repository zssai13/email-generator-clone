# Design Fix: Tab 1 Missing Images/Branding via Smart Pre-Extraction

## Problem

The Beach Bunny product page is **1,127,115 characters (1.1MB)** but we truncate to **100,000 characters (100KB)** before Claude sees it. Claude only gets **8.9% of the page**. The logo URL, product image CDN URLs, Shopify product JSON, and structured data are in the truncated portion.

**Result**: Claude generates generic emails without the actual brand logo, real product images, or accurate product details.

## Root Cause

In `app/api/generate/route.js`, the `executeTool` function truncates:
```javascript
return { result: html.substring(0, 100000), diagnostics };
```

On Shopify sites, critical data lives beyond 100KB:
- Product gallery image URLs (CDN paths)
- Logo image URL
- `<script type="application/ld+json">` structured data
- Shopify product JSON in `<script>` tags
- Full product descriptions

## Solution

**Two fetch methods available as a selector in Tab 1:**

1. **Standard (100KB)** - Original method. Truncates HTML to 100KB and sends to Claude as-is.
2. **Smart Fetch** - Pre-extracts critical data from the FULL HTML using Cheerio before truncating, then includes structured context alongside the truncated HTML.

This allows A/B comparison of both approaches on the same product URL.

## Smart Fetch: What It Extracts

Using Cheerio on the full HTML before truncation:

1. **Logo URL** - `img` tags with "logo" in src/class/alt, header area images
2. **Product images** - Priority-based selectors (Shopify-aware), top 5, absolute URLs
3. **Product title** - `h1`, `meta[og:title]`, `title`
4. **Product price** - `.price`, `[data-price]`, `[itemprop="price"]`
5. **Product description** - `.product-description`, `meta[og:description]`
6. **Structured data (JSON-LD)** - `<script type="application/ld+json">` Product schema
7. **Shopify product JSON** - Embedded product data in script tags
8. **Meta tags** - og:image, og:title, og:description

## How It Works

The extracted data is prepended to the tool result Claude receives:

```
--- PRE-EXTRACTED PRODUCT DATA ---
Logo URL: https://example.com/cdn/shop/files/logo.png
Product Title: Tessa Tango Bottom - Turquoise/Aqua
Product Price: $98.00
Product Description: Meet the skirt that turns every moment...
Product Images (5 found):
  1. https://example.com/cdn/shop/files/TESSA_TANGO_...jpg (hero)
  2. ...
Structured Data: Found (Product schema)
--- END PRE-EXTRACTED DATA ---

--- PAGE HTML (truncated) ---
<!doctype html>...
```

Claude gets both: guaranteed product data + page structure context.

## Key Design Decisions

1. **Selector, not replacement** - Both methods live side by side so we can compare results
2. **Prepend to tool result** - No prompt structure changes needed
3. **Keep 100KB truncation** - Truncated HTML still provides page structure context
4. **Logo extraction inverted from Tab 2** - Tab 2 filters OUT logos; we specifically WANT them
5. **JSON-LD is most reliable** - Shopify always outputs structured data with accurate product info
6. **Diagnostic log shows extraction results** - Download log reveals what was extracted

## Files Modified

- `app/api/generate/route.js` - Cheerio import, preExtractProductData(), formatExtractedData(), fetchMethod routing
- `app/page.jsx` - Fetch method selector dropdown, pass fetchMethod to API

## Testing

1. Test with Beach Bunny URL using Standard method → download log
2. Test same URL with Smart Fetch → download log
3. Compare: Smart Fetch should have real logo, CDN images, correct product data
4. Try with non-Shopify sites to verify graceful fallback
