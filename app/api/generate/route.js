import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';

// Allow up to 60s on Vercel Pro (default is 10s on Hobby)
export const maxDuration = 60;

const client = new Anthropic();

// Define the tool Claude can use
const tools = [
  {
    name: "fetch_url",
    description: "Fetches the HTML content of a URL",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch"
        }
      },
      required: ["url"]
    }
  }
];

// Resolve a URL to absolute
function toAbsoluteUrl(src, baseUrl) {
  if (!src) return null;
  try {
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('http')) return src;
    return new URL(src, baseUrl).href;
  } catch {
    return null;
  }
}

// Pre-extract critical product data from FULL HTML using Cheerio
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

  // --- META TAGS ---
  data.metaTags.ogImage = $('meta[property="og:image"]').attr('content') || null;
  data.metaTags.ogTitle = $('meta[property="og:title"]').attr('content') || null;
  data.metaTags.ogDescription = $('meta[property="og:description"]').attr('content') || null;

  // --- LOGO ---
  // Look for logo images (Tab 2 filters these OUT; we specifically WANT them)
  const logoSelectors = [
    'img[src*="logo" i]', 'img[alt*="logo" i]', 'img[class*="logo" i]',
    'header img', 'nav img', '#header img', '.header img',
    '.site-header img', '.navbar-brand img',
    'link[rel="icon"]', 'link[rel="shortcut icon"]'
  ];
  for (const sel of logoSelectors) {
    const el = $(sel).first();
    if (el.length) {
      const src = el.attr('src') || el.attr('href');
      const resolved = toAbsoluteUrl(src, url);
      if (resolved) {
        data.logo = resolved;
        break;
      }
    }
  }

  // --- TITLE ---
  const titleSelectors = [
    'h1.product-title', 'h1[data-product-title]', '.product-title h1', 'h1'
  ];
  for (const sel of titleSelectors) {
    const text = $(sel).first().text().trim();
    if (text) { data.title = text; break; }
  }
  if (!data.title) data.title = data.metaTags.ogTitle || $('title').text().trim() || null;

  // --- PRICE ---
  const priceSelectors = [
    '.price', '.product-price', '[data-price]', '.price-current',
    '.sale-price', '[itemprop="price"]', '.cost', '.amount'
  ];
  for (const sel of priceSelectors) {
    const el = $(sel).first();
    const text = el.text().trim();
    if (text && /\d/.test(text)) {
      // Extract price-like value
      const match = text.match(/[\$\£\€]?\s*[\d,]+\.?\d*/);
      data.price = match ? match[0].trim() : text;
      break;
    }
    // Check data attributes
    const dataPrice = el.attr('data-price') || el.attr('content');
    if (dataPrice) { data.price = '$' + dataPrice; break; }
  }

  // --- DESCRIPTION ---
  const descSelectors = [
    '.product-description', '.description', '[data-product-description]',
    '.product-details', '.product-info', '[itemprop="description"]'
  ];
  for (const sel of descSelectors) {
    const text = $(sel).first().text().trim();
    if (text && text.length > 20) {
      data.description = text.substring(0, 500);
      break;
    }
  }
  if (!data.description) {
    data.description = data.metaTags.ogDescription || $('meta[name="description"]').attr('content') || null;
  }

  // --- PRODUCT IMAGES ---
  const seenUrls = new Set();
  const addImage = (src, priority) => {
    const resolved = toAbsoluteUrl(src, url);
    if (!resolved || seenUrls.has(resolved)) return;
    // Filter out tiny images, icons, tracking pixels
    const lower = resolved.toLowerCase();
    if (lower.includes('pixel') || lower.includes('tracking') || lower.includes('spacer')) return;
    if (lower.includes('badge') || lower.includes('flag') || lower.includes('avatar')) return;
    seenUrls.add(resolved);
    data.images.push({ url: resolved, priority });
  };

  // Priority 1: Hero/Main product images
  const p1Selectors = [
    '.hero img', '.product-hero img', '.main-image', 'img[data-main-image]',
    'img[data-product-image="main"]',
    '.product__media img', '.product-single__media img',  // Shopify
    '.woocommerce-product-gallery img'  // WooCommerce
  ];
  for (const sel of p1Selectors) {
    $(sel).each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-srcset')?.split(' ')[0];
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

  // OG image as fallback
  if (data.metaTags.ogImage) {
    addImage(data.metaTags.ogImage, 1);
  }

  // --- STRUCTURED DATA (JSON-LD) ---
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      // Could be a single object or an array
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
            const curr = data.structuredData.currency === 'USD' ? '$' : (data.structuredData.currency || '$');
            data.price = curr + data.structuredData.price;
          }
          if (!data.description && data.structuredData.description) data.description = data.structuredData.description;
          break;
        }
      }
    } catch { /* ignore parse errors */ }
  });

  // --- SHOPIFY PRODUCT JSON ---
  $('script').each((_, el) => {
    const scriptContent = $(el).html() || '';
    // Look for Shopify product JSON patterns
    if (scriptContent.includes('"product"') && scriptContent.includes('"variants"')) {
      try {
        // Try to extract product JSON from various Shopify patterns
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

  // Also try data-product-json script tags (Shopify)
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

  // Sort images: priority 1 first, then priority 2, keep top 5
  data.images.sort((a, b) => a.priority - b.priority);
  data.images = data.images.slice(0, 5);

  return data;
}

// Format extracted data as text context for Claude
function formatExtractedData(data) {
  let output = '--- PRE-EXTRACTED PRODUCT DATA ---\n';
  output += `IMPORTANT: Use this extracted data for accurate product information, images, and branding.\n\n`;

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

// Format extracted data for the diagnostic log
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

// Execute the fetch tool - supports 'standard' and 'smart' methods
async function executeTool(toolName, toolInput, fetchMethod) {
  if (toolName === "fetch_url") {
    const diagnostics = { url: toolInput.url, fetchMethod };
    let extractedData = null;
    try {
      const response = await fetch(toolInput.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      diagnostics.httpStatus = response.status;
      const html = await response.text();
      diagnostics.htmlSizeChars = html.length;
      const truncateLimit = fetchMethod === 'standard-200k' ? 200000 : 100000;
      diagnostics.wasTruncated = html.length > truncateLimit;
      diagnostics.htmlPreview = html.substring(0, 500);

      let result;
      if (fetchMethod === 'smart') {
        // Smart Fetch: pre-extract critical data from FULL HTML, then prepend to truncated HTML
        extractedData = preExtractProductData(html, toolInput.url);
        const dataContext = formatExtractedData(extractedData);
        const truncatedHtml = html.substring(0, 100000);
        result = dataContext + '\n\n--- PAGE HTML (first 100KB) ---\n' + truncatedHtml;
        diagnostics.smartFetchExtracted = {
          logo: extractedData.logo ? 'found' : 'not found',
          title: extractedData.title || 'not found',
          price: extractedData.price || 'not found',
          imagesFound: extractedData.images.length,
          structuredData: extractedData.structuredData ? 'found' : 'not found'
        };
      } else if (fetchMethod === 'clean') {
        // Clean 100KB: strip boilerplate, then truncate
        const $clean = cheerio.load(html);
        $clean('script, style, nav, header, footer, noscript, svg, iframe').remove();
        result = $clean.html().substring(0, 100000);
      } else if (fetchMethod === 'standard-200k') {
        // Standard 200KB: double the truncation limit
        result = html.substring(0, 200000);
      } else {
        // Standard: truncate to 100KB as before
        result = html.substring(0, 100000);
      }

      return { result, diagnostics, extractedData };
    } catch (error) {
      diagnostics.error = error.message;
      return { result: `Error fetching URL: ${error.message}`, diagnostics, extractedData: null };
    }
  }
  return { result: "Unknown tool", diagnostics: { error: "Unknown tool" }, extractedData: null };
}

// Extract clean HTML from Claude's response
function extractHtml(text) {
  const codeBlockMatch = text.match(/```html\s*([\s\S]*?)```/i);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  const genericCodeBlock = text.match(/```\s*(<!DOCTYPE[\s\S]*?<\/html>)\s*```/i);
  if (genericCodeBlock) return genericCodeBlock[1].trim();

  const htmlMatch = text.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
  if (htmlMatch) return htmlMatch[1].trim();

  return text.trim();
}

// Format the generation log as human-readable plain text
function formatLog(log) {
  let output = '';
  output += '========================================\n';
  output += 'EMAIL GENERATOR - DIAGNOSTIC LOG\n';
  output += '========================================\n';
  output += `Timestamp: ${log.timestamp}\n`;
  output += `Product URL: ${log.productUrl}\n`;
  output += `Model: ${log.model || 'claude-opus-4-5-20251101'}\n`;
  output += `Fetch Method: ${log.fetchMethod}\n`;
  output += `Custom Prompt: ${log.customPrompt}\n`;
  output += '\n';

  output += '--- PROMPT SENT TO CLAUDE ---\n';
  output += `${log.promptSent}\n`;
  output += '\n';

  if (log.toolCalls.length > 0) {
    for (const call of log.toolCalls) {
      output += `--- TOOL CALL #${call.iteration} ---\n`;
      output += `Tool: ${call.toolName}\n`;
      output += `Fetch Method: ${call.fetchMethod || 'standard'}\n`;
      output += `URL Fetched: ${call.url || '(none)'}\n`;
      if (call.httpStatus !== undefined) {
        output += `HTTP Status: ${call.httpStatus}\n`;
      }
      if (call.htmlSizeChars !== undefined) {
        output += `HTML Size: ${call.htmlSizeChars.toLocaleString()} characters\n`;
        output += `Truncated: ${call.wasTruncated ? 'Yes (over 100KB limit)' : 'No'}\n`;
      }
      if (call.smartFetchExtracted) {
        output += `Smart Fetch Results:\n`;
        output += `  Logo: ${call.smartFetchExtracted.logo}\n`;
        output += `  Title: ${call.smartFetchExtracted.title}\n`;
        output += `  Price: ${call.smartFetchExtracted.price}\n`;
        output += `  Images Found: ${call.smartFetchExtracted.imagesFound}\n`;
        output += `  Structured Data: ${call.smartFetchExtracted.structuredData}\n`;
      }
      if (call.htmlPreview) {
        output += `HTML Preview (first 500 chars):\n${call.htmlPreview}\n`;
      }
      if (call.error) {
        output += `Error: ${call.error}\n`;
      }
      output += '\n';
    }
  } else {
    output += '--- TOOL CALLS ---\n';
    output += 'None - Claude did not call any tools\n\n';
  }

  // Show full extracted data if smart fetch was used
  if (log.extractedData) {
    output += formatExtractedDataForLog(log.extractedData);
    output += '\n';
  }

  if (log.claudeTextBlocks.length > 0) {
    output += '--- CLAUDE ANALYSIS (text between tool calls) ---\n';
    for (let i = 0; i < log.claudeTextBlocks.length; i++) {
      output += `[Block ${i + 1}]: ${log.claudeTextBlocks[i]}\n\n`;
    }
  }

  output += '--- FINAL OUTPUT ---\n';
  output += `Generated HTML Length: ${log.finalOutput.htmlLength.toLocaleString()} characters\n`;
  output += `HTML Parse Success: ${log.finalOutput.parseSuccess ? 'Yes' : 'No'}\n`;
  output += '\n';

  if (log.tokenUsage) {
    output += '--- TOKEN USAGE ---\n';
    output += `Input Tokens: ${log.tokenUsage.inputTokens?.toLocaleString() || 'N/A'}\n`;
    output += `Output Tokens: ${log.tokenUsage.outputTokens?.toLocaleString() || 'N/A'}\n`;
    output += `Total: ${((log.tokenUsage.inputTokens || 0) + (log.tokenUsage.outputTokens || 0)).toLocaleString()}\n`;
    output += '\n';
  }

  output += '--- ERRORS ---\n';
  if (log.errors.length > 0) {
    for (const err of log.errors) {
      output += `- ${err}\n`;
    }
  } else {
    output += 'None\n';
  }
  output += '\n========================================\n';

  return output;
}

const EMAIL_SYSTEM_PROMPT = `You are an expert email HTML developer. Generate production-ready promotional emails that render perfectly across ALL email clients (Gmail, Outlook, Apple Mail, Yahoo, mobile).

CENTERING RULES (critical):
- Wrap everything in a <center> tag with width:100% and background color
- Main email table: use BOTH align="center" attribute AND style="margin: 0 auto;" — never just one
- Use MSO conditional comments to wrap the main table in a fixed-width 600px table for Outlook
- Every <td> that contains centered content MUST have text-align: center in its inline style
- Images: use display: block; margin: 0 auto; on the img tag AND text-align: center on the parent <td>
- CTA buttons: wrap in a <table> with align="center" attribute
- Never rely solely on margin: 0 auto for centering — always pair with align="center" or text-align: center

LAYOUT RULES:
- Table-based layout ONLY — no divs for structure, no flexbox, no grid
- All styles must be inline (style="...") — do not rely on <style> blocks for critical layout
- Set explicit widths on tables and cells (width="600" or width="100%")
- Use max-width: 600px on the main table with width: 100% for fluid behavior
- All images need: display: block; margin: 0 auto; width: 100%; max-width: [size]px; height: auto;
- Use role="presentation" on layout tables, cellspacing="0" cellpadding="0" border="0"

GMAIL SAFETY:
- Gmail strips <style> blocks in non-AMP emails — all critical styles MUST be inline
- Avoid CSS shorthand in inline styles (use padding-left, padding-right separately if needed)
- Use simple font stacks: Arial, Helvetica, sans-serif or Georgia, Times New Roman, serif

MOBILE:
- Add a <style> block with @media queries as progressive enhancement (not required for layout)
- Use class="email-container" on main table for responsive override
- Stack columns on mobile with display: block !important

OUTPUT: Return ONLY the raw HTML. No markdown, no code blocks, no explanation.`;

export async function POST(request) {
  // Initialize diagnostic log
  const generationLog = {
    timestamp: new Date().toISOString(),
    productUrl: '',
    fetchMethod: 'standard',
    customPrompt: '(none)',
    promptSent: '',
    toolCalls: [],
    claudeTextBlocks: [],
    extractedData: null,
    finalOutput: { htmlLength: 0, parseSuccess: false },
    tokenUsage: null,
    errors: []
  };

  try {
    const { productUrl, customPrompt, fetchMethod, model } = await request.json();

    // Model selection
    const modelMap = {
      'claude-opus-4-5': 'claude-opus-4-5-20251101',
      'claude-opus-4-6': 'claude-opus-4-6'
    };
    const selectedModel = modelMap[model] || modelMap['claude-opus-4-5'];
    generationLog.model = selectedModel;

    const validMethods = ['standard', 'standard-200k', 'clean', 'smart'];
    const selectedFetchMethod = validMethods.includes(fetchMethod) ? fetchMethod : 'standard';
    generationLog.productUrl = productUrl || '';
    generationLog.fetchMethod = selectedFetchMethod;
    generationLog.customPrompt = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : '(none)';

    if (!productUrl) {
      generationLog.errors.push('Product URL is required');
      return Response.json({ error: 'Product URL is required', diagnosticLog: formatLog(generationLog) }, { status: 400 });
    }

    // Build the prompt with optional custom instructions
    let promptContent = `Create a beautiful promotional ecommerce email for this product: ${productUrl}`;

    if (customPrompt && customPrompt.trim()) {
      promptContent += `\n\nAdditional instructions: ${customPrompt.trim()}`;
    }

    // If smart fetch, add instruction to use pre-extracted data
    if (selectedFetchMethod === 'smart') {
      promptContent += `\n\nIMPORTANT: When you fetch the product page, the response will include PRE-EXTRACTED PRODUCT DATA at the top. Use this data for accurate product images, logo, title, price, and description. Always use the real logo image URL and real product image URLs provided.`;
    }

    // Output format is handled by the system prompt

    generationLog.promptSent = promptContent;

    let messages = [
      {
        role: 'user',
        content: promptContent
      }
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    let response = await client.messages.create({
      model: selectedModel,
      max_tokens: 16000,
      system: EMAIL_SYSTEM_PROMPT,
      tools,
      messages
    });

    if (response.usage) {
      totalInputTokens += response.usage.input_tokens || 0;
      totalOutputTokens += response.usage.output_tokens || 0;
    }

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(block => block.type === 'tool_use');
      if (!toolUseBlock) break;

      response.content
        .filter(block => block.type === 'text' && block.text.trim())
        .forEach(block => {
          generationLog.claudeTextBlocks.push(block.text.substring(0, 1000));
        });

      const { result: toolResult, diagnostics, extractedData } = await executeTool(toolUseBlock.name, toolUseBlock.input, selectedFetchMethod);

      // Store extracted data in log if smart fetch
      if (extractedData) {
        generationLog.extractedData = extractedData;
      }

      generationLog.toolCalls.push({
        iteration: generationLog.toolCalls.length + 1,
        toolName: toolUseBlock.name,
        ...diagnostics
      });

      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: toolResult
          }]
        }
      ];

      response = await client.messages.create({
        model: selectedModel,
        max_tokens: 16000,
        system: EMAIL_SYSTEM_PROMPT,
        tools,
        messages
      });

      if (response.usage) {
        totalInputTokens += response.usage.input_tokens || 0;
        totalOutputTokens += response.usage.output_tokens || 0;
      }
    }

    generationLog.tokenUsage = {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens
    };

    const rawResponse = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    const emailHtml = extractHtml(rawResponse);

    generationLog.finalOutput = {
      htmlLength: emailHtml.length,
      parseSuccess: /^<!DOCTYPE/i.test(emailHtml) || /^<html/i.test(emailHtml)
    };

    // Calculate cost based on model
    // Opus 4.5: $15/$75 per 1M tokens | Opus 4.6: $5/$25 per 1M tokens
    const isOpus46 = selectedModel === 'claude-opus-4-6';
    const INPUT_RATE  = isOpus46 ? 5.00 / 1_000_000 : 15.00 / 1_000_000;
    const OUTPUT_RATE = isOpus46 ? 25.00 / 1_000_000 : 75.00 / 1_000_000;
    const estimatedCost = (totalInputTokens * INPUT_RATE) + (totalOutputTokens * OUTPUT_RATE);

    return Response.json({
      success: true,
      content: emailHtml,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
        estimated_cost_usd: estimatedCost,
        model: selectedModel
      },
      diagnosticLog: formatLog(generationLog)
    });

  } catch (error) {
    console.error('API Error:', error);
    generationLog.errors.push(error.message || 'Unknown error');
    return Response.json({
      error: error.message || 'Failed to generate email',
      diagnosticLog: formatLog(generationLog)
    }, { status: 500 });
  }
}
