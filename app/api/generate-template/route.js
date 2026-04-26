import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';

// Allow up to 5 minutes for Vercel Pro (multi-step pipelines need this)
export const maxDuration = 300;

// Initialize Anthropic client lazily - uses environment variable only
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('Anthropic API key is not configured. Please set ANTHROPIC_API_KEY environment variable.');
  }
  
  return new Anthropic({ apiKey });
}

// Initialize OpenAI client lazily - uses environment variable only
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable.');
  }

  return new OpenAI({ apiKey });
}

// Initialize DeepSeek client lazily (OpenAI-compatible)
function getDeepSeekClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error('DeepSeek API key is not configured. Please set DEEPSEEK_API_KEY environment variable.');
  }

  return new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com'
  });
}

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

// Execute the fetch tool when Claude/OpenAI calls it
async function executeTool(toolName, toolInput) {
  if (toolName === "fetch_url") {
    try {
      const response = await fetch(toolInput.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      
      if (!response.ok) {
        return `Error fetching URL: HTTP ${response.status} ${response.statusText}`;
      }
      
      const html = await response.text();
      
      // For GPT-4o Mini, use smaller limit to avoid context issues
      // Claude can handle more, but we'll use a reasonable limit for both
      const maxLength = 50000; // Reduced from 100000 for better compatibility
      const truncated = html.length > maxLength 
        ? html.substring(0, maxLength) + `\n\n[HTML truncated - original length: ${html.length} characters]`
        : html;
      
      return truncated;
    } catch (error) {
      console.error('Error fetching URL:', error);
      return `Error fetching URL: ${error.message}`;
    }
  }
  return "Unknown tool";
}

// Validate URL format
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Validate HTML content
function isValidHtml(htmlString) {
  if (!htmlString || typeof htmlString !== 'string') {
    return false;
  }
  
  // Check if it contains HTML tags
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(htmlString);
  
  // Check if it has basic HTML structure (either DOCTYPE or html tag)
  const hasStructure = /<!DOCTYPE\s+html/i.test(htmlString) || /<html/i.test(htmlString);
  
  return hasHtmlTags && hasStructure;
}

// Get model configuration based on selected model
function getModelConfig(model) {
  const configs = {
    'claude-opus-4-6': {
      provider: 'anthropic',
      modelId: 'claude-opus-4-6',
      maxTokens: 16000
    },
    'claude-opus-4-5': {
      provider: 'anthropic',
      modelId: 'claude-opus-4-5-20251101',
      maxTokens: 16000
    },
    'claude-sonnet-4-5': { 
      provider: 'anthropic', 
      modelId: 'claude-sonnet-4-5-20250929',
      maxTokens: 16000 
    },
    'claude-haiku-4-5': { 
      provider: 'anthropic', 
      modelId: 'claude-haiku-4-5-20251001',
      maxTokens: 16000 
    },
    'gpt-4o': { 
      provider: 'openai', 
      modelId: 'gpt-4o',
      maxTokens: 16000 
    },
    'gpt-4o-mini': { 
      provider: 'openai', 
      modelId: 'gpt-4o-mini',
      maxTokens: 16000 
    },
    'gpt-4o-extract-mini-generate': { 
      provider: 'openai-hybrid', 
      extractModelId: 'gpt-4o',
      generateModelId: 'gpt-4o-mini',
      maxTokens: 16000 
    },
    'claude-sonnet-extract-mini-generate': { 
      provider: 'claude-hybrid', 
      extractModelId: 'claude-sonnet-4-5',
      generateModelId: 'gpt-4o-mini',
      maxTokens: 16000 
    },
    'claude-haiku-extract-mini-generate': { 
      provider: 'claude-hybrid', 
      extractModelId: 'claude-haiku-4-5',
      generateModelId: 'gpt-4o-mini',
      maxTokens: 16000 
    },
    'manual-extract-mini-refine-generate': {
      provider: 'manual-hybrid',
      extractMethod: 'manual',
      refineModelId: 'gpt-4o-mini',
      generateModelId: 'gpt-4o-mini',
      maxTokens: 16000
    },
    'manual-extract-5-mini-refine-generate': {
      provider: 'manual-5-mini-hybrid',
      extractMethod: 'manual',
      refineModelId: 'gpt-5-mini',
      generateModelId: 'gpt-5-mini',
      maxTokens: 16000
    },
    'manual-extract-opus-refine-generate': {
      provider: 'manual-opus-hybrid',
      extractMethod: 'manual',
      refineModelId: 'claude-opus-4-6',
      generateModelId: 'claude-opus-4-6',
      maxTokens: 16000
    },
    'manual-extract-sonnet-refine-generate': {
      provider: 'manual-sonnet-hybrid',
      extractMethod: 'manual',
      refineModelId: 'claude-sonnet-4-5-20250929',
      generateModelId: 'claude-sonnet-4-5-20250929',
      maxTokens: 16000
    },
    'manual-extract-haiku-refine-generate': {
      provider: 'manual-haiku-hybrid',
      extractMethod: 'manual',
      refineModelId: 'claude-haiku-4-5-20251001',
      generateModelId: 'claude-haiku-4-5-20251001',
      maxTokens: 16000
    },
    'manual-extract-deepseek-flash-refine-generate': {
      provider: 'manual-deepseek-hybrid',
      extractMethod: 'manual',
      refineModelId: 'deepseek-v4-flash',
      generateModelId: 'deepseek-v4-flash',
      maxTokens: 16000
    },
    'manual-extract-deepseek-pro-refine-generate': {
      provider: 'manual-deepseek-hybrid',
      extractMethod: 'manual',
      refineModelId: 'deepseek-v4-pro',
      generateModelId: 'deepseek-v4-pro',
      maxTokens: 16000
    }
  };
  return configs[model] || configs['claude-opus-4-5'];
}

// Build unified prompt for all models
function buildPrompt(productUrl, emailTemplate, customPrompt) {
  const trimmedUrl = productUrl.trim();
  const trimmedTemplate = emailTemplate.trim();
  const trimmedCustomPrompt = customPrompt.trim();

  // Base prompt
  let prompt = `Create an ecommerce promotional email for this product: ${trimmedUrl} using the following email template as inspiration and structure:

${trimmedTemplate}`;

  // Add custom prompt if provided
  if (trimmedCustomPrompt) {
    prompt += `\n\nAdditional instructions: ${trimmedCustomPrompt}`;
  }

  prompt += `\n\nReturn ONLY the complete HTML starting with <!DOCTYPE html> and ending with </html>. No markdown, no code blocks, no explanations.`;

  return prompt;
}

// Generate email using Claude (Opus or Sonnet)
async function generateWithClaude(prompt, modelConfig, tools) {
  const anthropicClient = getAnthropicClient();
  
  // Create initial message
  let messages = [
    { 
      role: 'user', 
      content: prompt
    }
  ];

  // Track total token usage across all API calls
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Call Claude API
  let response = await anthropicClient.messages.create({
    model: modelConfig.modelId,
    max_tokens: modelConfig.maxTokens,
    tools,
    messages
  });

  // Add first response tokens
  if (response.usage) {
    totalInputTokens += response.usage.input_tokens || 0;
    totalOutputTokens += response.usage.output_tokens || 0;
  }

  // Handle tool use loop (for fetching product page)
  while (response.stop_reason === 'tool_use') {
    const toolUseBlock = response.content.find(block => block.type === 'tool_use');
    if (!toolUseBlock) break;

    const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);

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

    response = await anthropicClient.messages.create({
      model: modelConfig.modelId,
      max_tokens: modelConfig.maxTokens,
      tools,
      messages
    });

    // Add subsequent response tokens
    if (response.usage) {
      totalInputTokens += response.usage.input_tokens || 0;
      totalOutputTokens += response.usage.output_tokens || 0;
    }
  }

  // Extract text from response
  const rawResponse = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Log token usage
  console.log('Claude Token Usage:', {
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    total_tokens: totalInputTokens + totalOutputTokens,
    model: modelConfig.modelId
  });

  // Return response with token usage metadata
  return {
    content: rawResponse,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens
    }
  };
}

// Calculate OpenAI cost based on token usage
function calculateOpenAICost(modelId, inputTokens, outputTokens) {
  const pricing = {
    'gpt-4o': { input: 0.0025, output: 0.010 }, // per 1K tokens
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 }, // per 1K tokens
    'gpt-5-mini': { input: 0.00025, output: 0.002 } // per 1K tokens
  };

  const modelPricing = pricing[modelId] || pricing['gpt-4o-mini'];
  const inputCost = (inputTokens / 1000) * modelPricing.input;
  const outputCost = (outputTokens / 1000) * modelPricing.output;

  return (inputCost + outputCost).toFixed(6);
}

// Calculate DeepSeek cost based on token usage (cache-miss standard pricing)
function calculateDeepSeekCost(modelId, inputTokens, outputTokens) {
  const pricing = {
    'deepseek-v4-flash': { input: 0.00014, output: 0.00028 }, // $0.14/$0.28 per 1M
    'deepseek-v4-pro': { input: 0.00174, output: 0.00348 }    // $1.74/$3.48 per 1M
  };

  const modelPricing = pricing[modelId] || pricing['deepseek-v4-flash'];
  const inputCost = (inputTokens / 1000) * modelPricing.input;
  const outputCost = (outputTokens / 1000) * modelPricing.output;

  return (inputCost + outputCost).toFixed(6);
}

// Convert Claude tools format to OpenAI tools format (newer API)
function convertToolsToOpenAITools(tools) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
}

// Generate email using OpenAI (GPT-4o or GPT-4o-mini)
async function generateWithOpenAI(prompt, modelConfig) {
  const openaiClient = getOpenAIClient();
  
  // Convert tools to OpenAI tools format
  const openaiTools = convertToolsToOpenAITools(tools);

  // Create initial messages (OpenAI format)
  let messages = [
    {
      role: 'user',
      content: prompt
    }
  ];

  // Track total token usage across all API calls
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Call OpenAI API with tools (newer API format)
  let response;
  try {
    response = await openaiClient.chat.completions.create({
      model: modelConfig.modelId,
      messages: messages,
      tools: openaiTools,
      tool_choice: 'auto',
      max_tokens: modelConfig.maxTokens
    });
  } catch (error) {
    console.error('OpenAI API Initial Call Error:', {
      error: error.message,
      model: modelConfig.modelId,
      error_details: error
    });
    throw error;
  }

  // Add first response tokens
  if (response.usage) {
    totalInputTokens += response.usage.prompt_tokens || 0;
    totalOutputTokens += response.usage.completion_tokens || 0;
  }

  // Log initial response structure
  console.log('OpenAI Initial Response:', {
    has_choices: !!response.choices,
    choices_length: response.choices?.length || 0,
    has_tool_calls: !!(response.choices?.[0]?.message?.tool_calls),
    tool_calls_count: response.choices?.[0]?.message?.tool_calls?.length || 0,
    finish_reason: response.choices?.[0]?.finish_reason,
    model: modelConfig.modelId
  });

  // Handle tool calling loop (for fetching product page)
  let iterationCount = 0;
  const maxIterations = 5; // Prevent infinite loops
  
  while (response.choices && response.choices[0] && response.choices[0].message.tool_calls && response.choices[0].message.tool_calls.length > 0 && iterationCount < maxIterations) {
    iterationCount++;
    const toolCalls = response.choices[0].message.tool_calls;
    
    console.log(`OpenAI Tool Call Iteration ${iterationCount}:`, {
      tool_calls_count: toolCalls.length,
      model: modelConfig.modelId
    });
    
    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: response.choices[0].message.content || null,
      tool_calls: toolCalls
    });

    // Execute each tool call
    for (const toolCall of toolCalls) {
      try {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        
        console.log(`Executing tool: ${functionName}`, { url: functionArgs.url });
        
        const functionResult = await executeTool(functionName, functionArgs);
        
        // Truncate very large results (GPT-4o Mini has context limits)
        const truncatedResult = typeof functionResult === 'string' && functionResult.length > 50000
          ? functionResult.substring(0, 50000) + '\n\n[Content truncated due to size limits]'
          : functionResult;

        // Add tool result message
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncatedResult
        });
      } catch (error) {
        console.error('Error executing tool:', error);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error executing tool: ${error.message}`
        });
      }
    }

    // Continue the conversation
    try {
      response = await openaiClient.chat.completions.create({
        model: modelConfig.modelId,
        messages: messages,
        tools: openaiTools,
        tool_choice: 'auto',
        max_tokens: modelConfig.maxTokens
      });

      // Add subsequent response tokens
      if (response.usage) {
        totalInputTokens += response.usage.prompt_tokens || 0;
        totalOutputTokens += response.usage.completion_tokens || 0;
      }
    } catch (error) {
      console.error('OpenAI API Error:', error);
      throw error;
    }
  }

  // Check if we have a valid response
  if (!response.choices || !response.choices[0] || !response.choices[0].message) {
    console.error('OpenAI Invalid Response Structure:', {
      response: JSON.stringify(response, null, 2),
      model: modelConfig.modelId
    });
    throw new Error('Invalid response from OpenAI API');
  }

  // Extract content from response
  const rawResponse = response.choices[0].message.content || '';

  // Log final response details
  console.log('OpenAI Final Response:', {
    has_content: !!rawResponse,
    content_length: rawResponse.length,
    finish_reason: response.choices[0].finish_reason,
    tool_calls_made: iterationCount,
    model: modelConfig.modelId
  });

  if (!rawResponse || rawResponse.trim().length === 0) {
    console.error('OpenAI Empty Response Details:', {
      messages_count: messages.length,
      last_message: messages[messages.length - 1],
      finish_reason: response.choices[0].finish_reason,
      response_structure: response.choices[0],
      model: modelConfig.modelId
    });
    throw new Error('OpenAI returned an empty response. The model may have encountered an error or hit context limits.');
  }

  // Calculate cost
  const estimatedCost = calculateOpenAICost(modelConfig.modelId, totalInputTokens, totalOutputTokens);
  
  // Log token usage
  console.log('OpenAI Token Usage:', {
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    total_tokens: totalInputTokens + totalOutputTokens,
    model: modelConfig.modelId,
    estimated_cost_usd: `$${estimatedCost}`
  });

  // Return response with usage metadata (matching Claude format)
  return {
    content: rawResponse,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: parseFloat(estimatedCost)
    }
  };
}

// Extract product data using Claude Haiku (cheapest option)
async function extractProductDataWithClaudeHaiku(productUrl, tools) {
  const anthropicClient = getAnthropicClient();
  
  const extractionPrompt = `Extract product information from this URL: ${productUrl}

Please fetch the page and extract the following information in JSON format:
{
  "title": "Product title",
  "price": "Product price",
  "description": "Product description",
  "images": ["image_url_1", "image_url_2", ...],
  "features": ["feature1", "feature2", ...],
  "url": "${productUrl}"
}

IMPORTANT:
- Convert all image URLs to absolute URLs (full https:// URLs)
- Extract the main product image first
- Include all relevant product images
- Return ONLY valid JSON, no markdown, no code blocks`;

  let messages = [{ role: 'user', content: extractionPrompt }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  
  // Get the correct Claude Haiku model ID from config
  const haikuConfig = getModelConfig('claude-haiku-4-5');
  
  // Call Claude Haiku to extract data
  let response = await anthropicClient.messages.create({
    model: haikuConfig.modelId,
    messages: messages,
    tools: tools,
    max_tokens: 4000
  });

  if (response.usage) {
    totalInputTokens += response.usage.input_tokens || 0;
    totalOutputTokens += response.usage.output_tokens || 0;
  }

  // Handle tool use loop (for fetching product page)
  let iterationCount = 0;
  while (response.stop_reason === 'tool_use' && iterationCount < 3) {
    iterationCount++;
    const toolUseBlock = response.content.find(block => block.type === 'tool_use');
    if (!toolUseBlock) break;

    const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);
    
    const truncatedResult = typeof toolResult === 'string' && toolResult.length > 30000
      ? toolResult.substring(0, 30000) + '\n\n[Content truncated]'
      : toolResult;

    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { 
        role: 'user', 
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          content: truncatedResult
        }]
      }
    ];

    response = await anthropicClient.messages.create({
      model: haikuConfig.modelId,
      messages: messages,
      tools: tools,
      max_tokens: 4000
    });

    if (response.usage) {
      totalInputTokens += response.usage.input_tokens || 0;
      totalOutputTokens += response.usage.output_tokens || 0;
    }
  }

  // Extract JSON from response
  let productData;
  try {
    const rawResponse = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    
    // Try to extract JSON from response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      productData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found in response');
    }
  } catch (error) {
    console.error('Error parsing extracted data:', error);
    throw new Error('Failed to extract product data in valid JSON format');
  }

  // Calculate Claude Haiku cost ($1/$5 per million tokens)
  const haikuCost = (totalInputTokens / 1000000) * 1 + (totalOutputTokens / 1000000) * 5;

  console.log('Claude Haiku Extraction Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${haikuCost.toFixed(6)}`,
    product_data: productData
  });

  return {
    productData,
    extractionUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: haikuCost
    }
  };
}

// Manual HTML extraction (server-side, free) - extracts basic product data
async function extractProductDataManual(productUrl) {
  try {
    // Fetch HTML
    const response = await fetch(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);

    // === Parse JSON-LD structured data (rich product info from schema.org) ===
    let jsonLdData = null;
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const parsed = JSON.parse($(el).html());
        // Handle both single objects and arrays
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type'] === 'product') {
            jsonLdData = item;
            break;
          }
          // Check @graph arrays (common in Shopify)
          if (item['@graph']) {
            for (const graphItem of item['@graph']) {
              if (graphItem['@type'] === 'Product' || graphItem['@type'] === 'product') {
                jsonLdData = graphItem;
                break;
              }
            }
          }
        }
      } catch (e) { /* ignore malformed JSON-LD */ }
    });

    // === Extract title ===
    let title = '';
    // Try JSON-LD first (most reliable for product pages)
    if (jsonLdData?.name) {
      title = jsonLdData.name;
    }
    if (!title) {
      const titleSelectors = [
        'h1.product-title',
        'h1[data-product-title]',
        '.product-title h1',
        'h1',
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'title'
      ];

      for (const selector of titleSelectors) {
        if (selector.startsWith('meta')) {
          title = $(selector).attr('content') || '';
        } else {
          title = $(selector).first().text().trim();
        }
        if (title) break;
      }
    }

    // === Extract price ===
    let price = '';
    // Try JSON-LD first (structured, reliable)
    if (jsonLdData?.offers) {
      const offers = Array.isArray(jsonLdData.offers) ? jsonLdData.offers : [jsonLdData.offers];
      for (const offer of offers) {
        if (offer.price) {
          const currency = offer.priceCurrency || '';
          price = currency ? `${currency} ${offer.price}` : String(offer.price);
          break;
        }
        if (offer.lowPrice) {
          const currency = offer.priceCurrency || '';
          price = currency ? `${currency} ${offer.lowPrice}` : String(offer.lowPrice);
          break;
        }
      }
    }
    // Try Shopify global product JSON (window.ShopifyAnalytics, etc.)
    if (!price) {
      const priceMatch = html.match(/"price":\s*(\d+)/);
      if (priceMatch) {
        // Shopify stores price in cents
        const cents = parseInt(priceMatch[1]);
        if (cents > 100) {
          price = (cents / 100).toFixed(2);
        } else {
          price = String(cents);
        }
      }
    }
    // Try CSS selectors
    if (!price) {
      const priceSelectors = [
        '.price',
        '.product-price',
        '[data-price]',
        '.price-current',
        '.sale-price',
        '[itemprop="price"]',
        '.cost',
        '.amount'
      ];

      for (const selector of priceSelectors) {
        const text = $(selector).first().text().trim();
        const dataPrice = $(selector).attr('data-price') || '';
        const found = text || dataPrice;
        if (found) {
          // Extract price pattern (handles £24.99, $29.99, 24.99, etc.)
          const pricePattern = found.match(/([£$€]?\s?\d+[.,]\d{2})/);
          if (pricePattern) {
            price = pricePattern[1].trim();
          } else {
            price = found.replace(/[^\d.,£$€]/g, '').trim();
          }
          if (price) break;
        }
      }
    }
    // Try og:price meta tags
    if (!price) {
      price = $('meta[property="product:price:amount"]').attr('content') ||
              $('meta[property="og:price:amount"]').attr('content') || '';
    }

    // === Extract images with context - prioritize hero/main images ===
    const imagesWithContext = [];
    const seenUrls = new Set();

    // Helper to normalize URLs for deduplication
    const normalizeUrl = (url) => {
      if (!url) return '';
      let normalized = url.trim();
      if (normalized.startsWith('//')) normalized = `https:${normalized}`;
      // Remove query params for dedup (same image, different sizes)
      try { return new URL(normalized).origin + new URL(normalized).pathname; } catch { return normalized; }
    };

    // Priority 0: og:image meta tag (most reliable - platforms always set this to main product image)
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    if (ogImage) {
      let ogUrl = ogImage.trim();
      if (ogUrl.startsWith('//')) ogUrl = `https:${ogUrl}`;
      seenUrls.add(normalizeUrl(ogUrl));
      imagesWithContext.push({
        url: ogUrl,
        priority: 0,
        context: 'og:image (main product image)',
        width: null,
        height: null,
        isInHero: true,
        isInProductSection: true,
        isEarlyInPage: true,
        position: 0
      });
    }

    // Priority 0: JSON-LD product image (structured data)
    if (jsonLdData?.image) {
      const ldImages = Array.isArray(jsonLdData.image) ? jsonLdData.image : [jsonLdData.image];
      for (const ldImg of ldImages) {
        const imgUrl = typeof ldImg === 'string' ? ldImg : ldImg?.url || ldImg?.contentUrl || '';
        if (imgUrl && !seenUrls.has(normalizeUrl(imgUrl))) {
          let absUrl = imgUrl.trim();
          if (absUrl.startsWith('//')) absUrl = `https:${absUrl}`;
          seenUrls.add(normalizeUrl(absUrl));
          imagesWithContext.push({
            url: absUrl,
            priority: 0,
            context: 'json-ld product image',
            width: null,
            height: null,
            isInHero: true,
            isInProductSection: true,
            isEarlyInPage: true,
            position: 0
          });
        }
      }
    }

    // Priority 1: Hero/Main product image selectors (highest CSS priority)
    const heroImageSelectors = [
      { selector: '.hero img', priority: 1, context: 'hero-section' },
      { selector: '.product-hero img', priority: 1, context: 'product-hero' },
      { selector: '.main-image', priority: 1, context: 'main-image' },
      { selector: 'img[data-main-image]', priority: 1, context: 'data-main-image' },
      { selector: 'img[data-product-image="main"]', priority: 1, context: 'main-product-image' },
      { selector: '.product__media img:first-child', priority: 1, context: 'shopify-main' },
      { selector: '.product-single__media img:first-child', priority: 1, context: 'shopify-main' },
      { selector: '.woocommerce-product-gallery img:first-child', priority: 1, context: 'woocommerce-main' },
      // Shopify CDN product images (high confidence these are actual product photos)
      { selector: 'img[src*="cdn.shopify.com/s/files"]', priority: 1, context: 'shopify-cdn' },
      { selector: 'img[src*="/cdn/shop/files"]', priority: 1, context: 'shopify-cdn-relative' },
      { selector: 'img[data-src*="cdn.shopify.com/s/files"]', priority: 1, context: 'shopify-cdn-lazy' },
      { selector: 'img[data-src*="/cdn/shop/files"]', priority: 1, context: 'shopify-cdn-lazy-relative' },
      // srcset-based Shopify images
      { selector: 'img[srcset*="cdn.shopify.com"]', priority: 1, context: 'shopify-srcset' },
      { selector: 'img[srcset*="/cdn/shop/"]', priority: 1, context: 'shopify-srcset-relative' }
    ];

    // Priority 2: Product image selectors
    const productImageSelectors = [
      { selector: 'img.product-image', priority: 2, context: 'product-image-class' },
      { selector: 'img[data-product-image]', priority: 2, context: 'data-product-image' },
      { selector: '.product-images img', priority: 2, context: 'product-images' },
      { selector: '.product-gallery img', priority: 2, context: 'product-gallery' },
      { selector: 'img[src*="product"]', priority: 2, context: 'product-url' },
      { selector: 'img[alt*="product" i]', priority: 2, context: 'product-alt' },
      { selector: 'img.main-image', priority: 2, context: 'main-image-class' },
      { selector: 'img.primary-image', priority: 2, context: 'primary-image' },
      { selector: '.product__media img', priority: 2, context: 'shopify-media' },
      { selector: '.product-single__media img', priority: 2, context: 'shopify-single' }
    ];

    // Priority 3: General images (fallback)
    const generalImageSelectors = [
      { selector: 'img', priority: 3, context: 'general' }
    ];

    // Known non-product image domains to filter out
    const nonProductDomains = [
      'markethero-cdn', 'google-analytics', 'facebook.com', 'doubleclick',
      'googletagmanager', 'pixel', 'tracking', 'analytics', 'beacon',
      'fonts.googleapis', 'gravatar', 'wp-content/plugins'
    ];

    // Extract images with priority and context
    const allSelectors = [...heroImageSelectors, ...productImageSelectors];

    for (const { selector, priority, context } of allSelectors) {
      $(selector).each((i, el) => {
        const $el = $(el);
        // Try src, data-src, srcset (extract first URL from srcset)
        let src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('data-original') || '';

        // If no src found, try extracting from srcset (first entry)
        if (!src) {
          const srcset = $el.attr('srcset') || '';
          if (srcset) {
            src = srcset.split(',')[0].trim().split(/\s+/)[0];
          }
        }

        if (!src) return;
        const normalizedSrc = normalizeUrl(src);
        if (seenUrls.has(normalizedSrc)) return;

        // Filter out logos, icons, thumbnails, payment badges
        const srcLower = src.toLowerCase();
        const altLower = ($el.attr('alt') || '').toLowerCase();
        const classLower = ($el.attr('class') || '').toLowerCase();

        if (srcLower.includes('logo') || srcLower.includes('icon') ||
            altLower.includes('logo') || classLower.includes('logo') ||
            srcLower.includes('avatar') || srcLower.includes('thumbnail') ||
            srcLower.includes('badge') || srcLower.includes('flag') ||
            srcLower.includes('payment') || srcLower.includes('trust-seal') ||
            srcLower.endsWith('.svg') || srcLower.includes('spinner') ||
            srcLower.includes('placeholder')) {
          return;
        }

        // Filter out known non-product tracking/analytics domains
        if (nonProductDomains.some(domain => srcLower.includes(domain))) {
          return;
        }

        // Get image dimensions from HTML attributes
        const width = parseInt($el.attr('width') || $el.attr('data-width') || '0');
        const height = parseInt($el.attr('height') || $el.attr('data-height') || '0');

        // Filter out tiny images (likely icons/decorations) - skip if under 50px in either dimension
        if ((width > 0 && width < 50) || (height > 0 && height < 50)) {
          return;
        }

        // Check if image is in hero section
        const isInHero = $el.closest('.hero, .product-hero, .banner, .hero-section').length > 0;
        const isInProductSection = $el.closest('.product, .product-details, .product-info, [data-product]').length > 0;

        // Boost priority for Shopify CDN product images (if found via general selector)
        let effectivePriority = priority;
        if (srcLower.includes('cdn.shopify.com/s/files') || srcLower.includes('/cdn/shop/files')) {
          effectivePriority = Math.min(priority, 1); // Promote to priority 1
        }
        
        // Calculate position (earlier = better for hero images)
        const htmlPosition = html.indexOf(src);
        const isEarlyInPage = htmlPosition < html.length * 0.3; // First 30% of HTML
        
        imagesWithContext.push({
          url: src,
          priority: effectivePriority,
          context: context,
          width: width || null,
          height: height || null,
          isInHero: isInHero,
          isInProductSection: isInProductSection,
          isEarlyInPage: isEarlyInPage,
          position: htmlPosition
        });

        seenUrls.add(normalizedSrc);
      });
    }

    // If no images found with selectors, try general fallback
    if (imagesWithContext.length === 0) {
      $(generalImageSelectors[0].selector).each((i, el) => {
        const $el = $(el);
        let src = $el.attr('src') || $el.attr('data-src') || '';

        if (!src) return;
        const normalizedSrc = normalizeUrl(src);
        // Accept protocol-relative URLs (//domain.com/...) and absolute URLs
        if (!src.startsWith('http') && !src.startsWith('//')) return;
        if (seenUrls.has(normalizedSrc)) return;

        const srcLower = src.toLowerCase();
        if (srcLower.includes('logo') || srcLower.includes('icon') ||
            srcLower.endsWith('.svg') || srcLower.includes('payment') ||
            srcLower.includes('badge') || srcLower.includes('spinner')) return;

        // Filter out known non-product domains
        if (nonProductDomains.some(domain => srcLower.includes(domain))) return;

        // Boost Shopify CDN images even in fallback
        let fallbackPriority = 3;
        if (srcLower.includes('cdn.shopify.com/s/files') || srcLower.includes('/cdn/shop/files')) {
          fallbackPriority = 1;
        }

        imagesWithContext.push({
          url: src,
          priority: fallbackPriority,
          context: fallbackPriority === 1 ? 'shopify-cdn-fallback' : 'general-fallback',
          width: null,
          height: null,
          isInHero: false,
          isInProductSection: false,
          isEarlyInPage: false,
          position: html.indexOf(src)
        });

        seenUrls.add(normalizedSrc);
      });
    }
    
    // Sort by priority, then by position (earlier = better)
    imagesWithContext.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.position - b.position;
    });
    
    // Limit to top 15 images (will be refined by AI)
    const limitedImagesWithContext = imagesWithContext.slice(0, 15);
    
    // Extract description - try JSON-LD first, then multiple selectors
    let description = '';
    if (jsonLdData?.description && jsonLdData.description.length > 20) {
      description = jsonLdData.description;
    }
    if (!description || description.length <= 20) {
      const descSelectors = [
        '.product-description',
        '.description',
        '[data-product-description]',
        '.product-details',
        '.product-info',
        'meta[property="og:description"]',
        'meta[name="description"]',
        '[itemprop="description"]'
      ];

      for (const selector of descSelectors) {
        if (selector.startsWith('meta')) {
          description = $(selector).attr('content') || '';
        } else {
          description = $(selector).first().text().trim();
        }
        if (description && description.length > 20) break;
      }
    }
    
    // Truncate description if too long
    if (description.length > 500) {
      description = description.substring(0, 500) + '...';
    }
    
    // Convert relative URLs to absolute and prepare image data
    const baseUrl = new URL(productUrl);
    const processedImages = limitedImagesWithContext.map(imgData => {
      let absoluteUrl = imgData.url;
      if (!absoluteUrl.startsWith('http')) {
        if (absoluteUrl.startsWith('//')) {
          absoluteUrl = `https:${absoluteUrl}`;
        } else if (absoluteUrl.startsWith('/')) {
          absoluteUrl = `${baseUrl.origin}${absoluteUrl}`;
        } else {
          absoluteUrl = `${baseUrl.origin}/${absoluteUrl}`;
        }
      }
      
      return {
        url: absoluteUrl,
        priority: imgData.priority,
        context: imgData.context,
        width: imgData.width,
        height: imgData.height,
        isInHero: imgData.isInHero,
        isInProductSection: imgData.isInProductSection,
        isEarlyInPage: imgData.isEarlyInPage
      };
    });
    
    const rawData = {
      title: title || 'Product',
      price: price || '',
      description: description || '',
      images: processedImages, // Now includes context
      url: productUrl
    };
    
    console.log('Manual Extraction Complete:', {
      title: rawData.title,
      price: rawData.price,
      images_count: rawData.images.length,
      og_jsonld_images: rawData.images.filter(img => img.priority === 0).length,
      hero_images: rawData.images.filter(img => img.priority <= 1 || img.isInHero).length,
      shopify_cdn_images: rawData.images.filter(img => img.context?.includes('shopify')).length,
      json_ld_found: !!jsonLdData,
      description_length: rawData.description.length
    });
    
    return rawData;
    
  } catch (error) {
    console.error('Manual extraction error:', error);
    throw new Error(`Manual extraction failed: ${error.message}`);
  }
}

// Refine extracted data using GPT-4o Mini (small cost, ensures quality)
async function refineProductDataWithMini(rawData, productUrl) {
  const openaiClient = getOpenAIClient();
  
  // Prepare image context for AI
  const imageContext = rawData.images.map((img, index) => {
    const contextInfo = [];
    if (img.priority === 0) contextInfo.push('HIGHEST PRIORITY (og:image or JSON-LD - confirmed main product image)');
    else if (img.priority === 1) contextInfo.push('HIGH PRIORITY (hero/main/Shopify-CDN selector)');
    if (img.isInHero) contextInfo.push('in hero section');
    if (img.isInProductSection) contextInfo.push('in product section');
    if (img.isEarlyInPage) contextInfo.push('appears early in page');
    if (img.width && img.width > 500) contextInfo.push(`large (${img.width}px wide)`);
    if (img.context) contextInfo.push(`found via: ${img.context}`);
    
    return {
      url: img.url,
      index: index,
      context: contextInfo.join(', ') || 'general image',
      priority: img.priority,
      width: img.width
    };
  });
  
  const refinementPrompt = `Review and refine this extracted product data from ${productUrl}:

Product Data:
- Title: ${rawData.title}
- Price: ${rawData.price}
- Description: ${rawData.description.substring(0, 200)}${rawData.description.length > 200 ? '...' : ''}

Images Found (${rawData.images.length} total):
${imageContext.map(img => `[${img.index}] ${img.url}\n     Context: ${img.context}`).join('\n\n')}

CRITICAL INSTRUCTIONS FOR IMAGE PRIORITIZATION:
1. The MAIN HERO/PRODUCT IMAGE should be FIRST in the images array
2. Prioritize images with:
   - HIGHEST PRIORITY (priority 0) - these are from og:image or JSON-LD structured data, ALWAYS use these first as they are the confirmed main product image
   - HIGH PRIORITY (priority 1) - these were found using hero/main/Shopify-CDN selectors
   - "in hero section" - these are in the hero area
   - "appears early in page" - main images appear before description
   - Large width (>500px) - main product images are typically large
   - Images from cdn.shopify.com or /cdn/shop/ paths are actual product photos
   - Context containing "hero", "main", "primary", "shopify-main", "woocommerce-main"
3. EXCLUDE images that are:
   - Thumbnails (small width, <300px)
   - Logos or icons
   - Not product-related
4. Keep only the TOP 5 images (main hero + 4 best product images)
5. Convert any remaining relative URLs to absolute URLs (base: ${productUrl})

Please:
1. Validate all fields are present and reasonable
2. Prioritize main product hero image FIRST (use context clues above)
3. Clean price formatting (ensure it's a valid price format like "$XX.XX")
4. Improve description if it's too short or unclear (keep under 500 chars)
5. Ensure title is clean and readable

Return ONLY valid JSON in this exact format:
{
  "title": "Product title",
  "price": "Product price",
  "description": "Product description",
  "images": ["main_hero_image_url", "product_image_2", "product_image_3", "product_image_4", "product_image_5"],
  "url": "${productUrl}"
}

No markdown, no code blocks, no explanations.`;

  let messages = [{ role: 'user', content: refinementPrompt }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  if (response.usage) {
    totalInputTokens += response.usage.prompt_tokens || 0;
    totalOutputTokens += response.usage.completion_tokens || 0;
  }

  // Parse refined data
  let refinedData;
  try {
    const content = response.choices[0].message.content || '{}';
    refinedData = JSON.parse(content);
  } catch (error) {
    console.error('Error parsing refined data:', error);
    // Fallback to raw data if refinement fails
    refinedData = rawData;
  }

  const refinementCost = calculateOpenAICost('gpt-4o-mini', totalInputTokens, totalOutputTokens);

  console.log('AI Refinement Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${parseFloat(refinementCost).toFixed(6)}`,
    images_count: refinedData.images?.length || 0
  });

  return {
    productData: refinedData,
    refinementUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: parseFloat(refinementCost)
    }
  };
}

// Refine extracted data using Claude Opus 4.6 (higher quality refinement)
async function refineProductDataWithOpus(rawData, productUrl) {
  const anthropicClient = getAnthropicClient();

  // Prepare image context for AI
  const imageContext = rawData.images.map((img, index) => {
    const contextInfo = [];
    if (img.priority === 0) contextInfo.push('HIGHEST PRIORITY (og:image or JSON-LD - confirmed main product image)');
    else if (img.priority === 1) contextInfo.push('HIGH PRIORITY (hero/main/Shopify-CDN selector)');
    if (img.isInHero) contextInfo.push('in hero section');
    if (img.isInProductSection) contextInfo.push('in product section');
    if (img.isEarlyInPage) contextInfo.push('appears early in page');
    if (img.width && img.width > 500) contextInfo.push(`large (${img.width}px wide)`);
    if (img.context) contextInfo.push(`found via: ${img.context}`);

    return {
      url: img.url,
      index: index,
      context: contextInfo.join(', ') || 'general image',
      priority: img.priority,
      width: img.width
    };
  });

  const refinementPrompt = `Review and refine this extracted product data from ${productUrl}:

Product Data:
- Title: ${rawData.title}
- Price: ${rawData.price}
- Description: ${rawData.description.substring(0, 200)}${rawData.description.length > 200 ? '...' : ''}

Images Found (${rawData.images.length} total):
${imageContext.map(img => `[${img.index}] ${img.url}\n     Context: ${img.context}`).join('\n\n')}

CRITICAL INSTRUCTIONS FOR IMAGE PRIORITIZATION:
1. The MAIN HERO/PRODUCT IMAGE should be FIRST in the images array
2. Prioritize images with:
   - HIGHEST PRIORITY (priority 0) - these are from og:image or JSON-LD structured data, ALWAYS use these first as they are the confirmed main product image
   - HIGH PRIORITY (priority 1) - these were found using hero/main/Shopify-CDN selectors
   - "in hero section" - these are in the hero area
   - "appears early in page" - main images appear before description
   - Large width (>500px) - main product images are typically large
   - Images from cdn.shopify.com or /cdn/shop/ paths are actual product photos
   - Context containing "hero", "main", "primary", "shopify-main", "woocommerce-main"
3. EXCLUDE images that are:
   - Thumbnails (small width, <300px)
   - Logos or icons
   - Not product-related
4. Keep only the TOP 5 images (main hero + 4 best product images)
5. Convert any remaining relative URLs to absolute URLs (base: ${productUrl})

Please:
1. Validate all fields are present and reasonable
2. Prioritize main product hero image FIRST (use context clues above)
3. Clean price formatting (ensure it's a valid price format like "$XX.XX")
4. Improve description if it's too short or unclear (keep under 500 chars)
5. Ensure title is clean and readable

Return ONLY valid JSON in this exact format:
{
  "title": "Product title",
  "price": "Product price",
  "description": "Product description",
  "images": ["main_hero_image_url", "product_image_2", "product_image_3", "product_image_4", "product_image_5"],
  "url": "${productUrl}"
}

No markdown, no code blocks, no explanations.`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await anthropicClient.messages.create({
    model: 'claude-opus-4-6',
    messages: [{ role: 'user', content: refinementPrompt }],
    max_tokens: 2000
  });

  if (response.usage) {
    totalInputTokens += response.usage.input_tokens || 0;
    totalOutputTokens += response.usage.output_tokens || 0;
  }

  // Parse refined data
  let refinedData;
  try {
    const rawResponse = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      refinedData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found in response');
    }
  } catch (error) {
    console.error('Error parsing Opus refined data:', error);
    // Fallback to raw data if refinement fails
    refinedData = rawData;
  }

  // Opus 4.6 pricing: $5/$25 per 1M tokens
  const opusCost = (totalInputTokens / 1_000_000) * 5 + (totalOutputTokens / 1_000_000) * 25;

  console.log('Opus 4.6 Refinement Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${opusCost.toFixed(6)}`,
    images_count: refinedData.images?.length || 0
  });

  return {
    productData: refinedData,
    refinementUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: opusCost
    }
  };
}

// Extract product data using Claude Sonnet (cheaper alternative to GPT-4o)
async function extractProductDataWithClaudeSonnet(productUrl, tools) {
  const anthropicClient = getAnthropicClient();
  
  const extractionPrompt = `Extract product information from this URL: ${productUrl}

Please fetch the page and extract the following information in JSON format:
{
  "title": "Product title",
  "price": "Product price",
  "description": "Product description",
  "images": ["image_url_1", "image_url_2", ...],
  "features": ["feature1", "feature2", ...],
  "url": "${productUrl}"
}

IMPORTANT:
- Convert all image URLs to absolute URLs (full https:// URLs)
- Extract the main product image first
- Include all relevant product images
- Return ONLY valid JSON, no markdown, no code blocks`;

  let messages = [{ role: 'user', content: extractionPrompt }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  
  // Get the correct Claude Sonnet model ID from config
  const sonnetConfig = getModelConfig('claude-sonnet-4-5');
  
  // Call Claude Sonnet to extract data
  let response = await anthropicClient.messages.create({
    model: sonnetConfig.modelId,
    messages: messages,
    tools: tools,
    max_tokens: 4000
  });

  if (response.usage) {
    totalInputTokens += response.usage.input_tokens || 0;
    totalOutputTokens += response.usage.output_tokens || 0;
  }

  // Handle tool use loop (for fetching product page)
  let iterationCount = 0;
  while (response.stop_reason === 'tool_use' && iterationCount < 3) {
    iterationCount++;
    const toolUseBlock = response.content.find(block => block.type === 'tool_use');
    if (!toolUseBlock) break;

    const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);
    
    const truncatedResult = typeof toolResult === 'string' && toolResult.length > 30000
      ? toolResult.substring(0, 30000) + '\n\n[Content truncated]'
      : toolResult;

    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { 
        role: 'user', 
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          content: truncatedResult
        }]
      }
    ];

    response = await anthropicClient.messages.create({
      model: sonnetConfig.modelId,
      messages: messages,
      tools: tools,
      max_tokens: 4000
    });

    if (response.usage) {
      totalInputTokens += response.usage.input_tokens || 0;
      totalOutputTokens += response.usage.output_tokens || 0;
    }
  }

  // Extract JSON from response
  let productData;
  try {
    const rawResponse = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    
    // Try to extract JSON from response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      productData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found in response');
    }
  } catch (error) {
    console.error('Error parsing extracted data:', error);
    throw new Error('Failed to extract product data in valid JSON format');
  }

  // Calculate Claude cost (Sonnet pricing)
  const claudeCost = (totalInputTokens / 1000000) * 3 + (totalOutputTokens / 1000000) * 15; // $3/$15 per million

  console.log('Claude Sonnet Extraction Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${claudeCost.toFixed(6)}`,
    product_data: productData
  });

  return {
    productData,
    extractionUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: claudeCost
    }
  };
}

// Extract product data using GPT-4o (Step 1 of hybrid approach)
async function extractProductDataWithGPT4o(productUrl, tools) {
  const openaiClient = getOpenAIClient();
  const openaiTools = convertToolsToOpenAITools(tools);
  
  const extractionPrompt = `Extract product information from this URL: ${productUrl}

Please fetch the page and extract the following information in JSON format:
{
  "title": "Product title",
  "price": "Product price",
  "description": "Product description",
  "images": ["image_url_1", "image_url_2", ...],
  "features": ["feature1", "feature2", ...],
  "url": "${productUrl}"
}

IMPORTANT:
- Convert all image URLs to absolute URLs (full https:// URLs)
- Extract the main product image first
- Include all relevant product images
- Return ONLY valid JSON, no markdown, no code blocks`;

  let messages = [{ role: 'user', content: extractionPrompt }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  
  // Call GPT-4o to extract data
  let response = await openaiClient.chat.completions.create({
    model: 'gpt-4o',
    messages: messages,
    tools: openaiTools,
    tool_choice: 'auto',
    max_tokens: 4000,
    response_format: { type: 'json_object' }
  });

  if (response.usage) {
    totalInputTokens += response.usage.prompt_tokens || 0;
    totalOutputTokens += response.usage.completion_tokens || 0;
  }

  // Handle tool calling if needed
  let iterationCount = 0;
  while (response.choices?.[0]?.message?.tool_calls && iterationCount < 3) {
    iterationCount++;
    const toolCalls = response.choices[0].message.tool_calls;
    
    messages.push({
      role: 'assistant',
      content: response.choices[0].message.content || null,
      tool_calls: toolCalls
    });

    for (const toolCall of toolCalls) {
      try {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        const functionResult = await executeTool(functionName, functionArgs);
        
        const truncatedResult = typeof functionResult === 'string' && functionResult.length > 30000
          ? functionResult.substring(0, 30000) + '\n\n[Content truncated]'
          : functionResult;

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncatedResult
        });
      } catch (error) {
        console.error('Error in extraction tool:', error);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: ${error.message}`
        });
      }
    }

    response = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages: messages,
      tools: openaiTools,
      tool_choice: 'auto',
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    });

    if (response.usage) {
      totalInputTokens += response.usage.prompt_tokens || 0;
      totalOutputTokens += response.usage.completion_tokens || 0;
    }
  }

  // Parse extracted data
  let productData;
  try {
    const content = response.choices[0].message.content || '{}';
    productData = JSON.parse(content);
  } catch (error) {
    console.error('Error parsing extracted data:', error);
    throw new Error('Failed to extract product data in valid JSON format');
  }

  console.log('GPT-4o Extraction Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: calculateOpenAICost('gpt-4o', totalInputTokens, totalOutputTokens),
    product_data: productData
  });

  return {
    productData,
    extractionUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: parseFloat(calculateOpenAICost('gpt-4o', totalInputTokens, totalOutputTokens))
    }
  };
}

// Generate email using GPT-4o Mini with extracted data (Step 2 of hybrid approach)
async function generateEmailWithMini(template, productData, customPrompt) {
  const openaiClient = getOpenAIClient();
  
  const generationPrompt = `Create an ecommerce promotional email using the following email template structure and the provided product data.

Email Template:
${template}

Product Data:
${JSON.stringify(productData, null, 2)}

${customPrompt ? `Additional Instructions: ${customPrompt}` : ''}

Return ONLY the complete HTML starting with <!DOCTYPE html> and ending with </html>. 
- Use the product data to fill in the template
- Replace product titles, prices, images, and descriptions with the extracted data
- Preserve the template's structure and styling
- No markdown, no code blocks, no explanations`;

  let messages = [{ role: 'user', content: generationPrompt }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages,
    max_tokens: 16000
  });

  if (response.usage) {
    totalInputTokens += response.usage.prompt_tokens || 0;
    totalOutputTokens += response.usage.completion_tokens || 0;
  }

  const rawResponse = response.choices[0].message.content || '';

  console.log('GPT-4o Mini Generation Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: calculateOpenAICost('gpt-4o-mini', totalInputTokens, totalOutputTokens)
  });

  return {
    content: rawResponse,
    generationUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: parseFloat(calculateOpenAICost('gpt-4o-mini', totalInputTokens, totalOutputTokens))
    }
  };
}

// Generate email using Claude Opus 4.6 with extracted data
async function generateEmailWithOpus(template, productData, customPrompt) {
  const anthropicClient = getAnthropicClient();

  const generationPrompt = `Create an ecommerce promotional email using the following email template structure and the provided product data.

Email Template:
${template}

Product Data:
${JSON.stringify(productData, null, 2)}

${customPrompt ? `Additional Instructions: ${customPrompt}` : ''}

Return ONLY the complete HTML starting with <!DOCTYPE html> and ending with </html>.
- Use the product data to fill in the template
- Replace product titles, prices, images, and descriptions with the extracted data
- Preserve the template's structure and styling
- No markdown, no code blocks, no explanations`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await anthropicClient.messages.create({
    model: 'claude-opus-4-6',
    messages: [{ role: 'user', content: generationPrompt }],
    max_tokens: 16000
  });

  if (response.usage) {
    totalInputTokens += response.usage.input_tokens || 0;
    totalOutputTokens += response.usage.output_tokens || 0;
  }

  const rawResponse = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Opus 4.6 pricing: $5/$25 per 1M tokens
  const opusCost = (totalInputTokens / 1_000_000) * 5 + (totalOutputTokens / 1_000_000) * 25;

  console.log('Opus 4.6 Generation Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${opusCost.toFixed(6)}`
  });

  return {
    content: rawResponse,
    generationUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: opusCost
    }
  };
}

// Claude pricing lookup (per 1M tokens)
const CLAUDE_PRICING = {
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5-20251101': { input: 15, output: 75 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 }
};

function calculateClaudeCost(modelId, inputTokens, outputTokens) {
  const pricing = CLAUDE_PRICING[modelId] || CLAUDE_PRICING['claude-sonnet-4-5-20250929'];
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

// Generic Claude refine function (works for Sonnet, Haiku, etc.)
async function refineProductDataWithClaude(rawData, productUrl, modelId) {
  const anthropicClient = getAnthropicClient();

  const imageContext = rawData.images.map((img, index) => {
    const contextInfo = [];
    if (img.priority === 0) contextInfo.push('HIGHEST PRIORITY (og:image or JSON-LD - confirmed main product image)');
    else if (img.priority === 1) contextInfo.push('HIGH PRIORITY (hero/main/Shopify-CDN selector)');
    if (img.isInHero) contextInfo.push('in hero section');
    if (img.isInProductSection) contextInfo.push('in product section');
    if (img.isEarlyInPage) contextInfo.push('appears early in page');
    if (img.width && img.width > 500) contextInfo.push(`large (${img.width}px wide)`);
    if (img.context) contextInfo.push(`found via: ${img.context}`);
    return {
      url: img.url, index, context: contextInfo.join(', ') || 'general image',
      priority: img.priority, width: img.width
    };
  });

  const refinementPrompt = `Review and refine this extracted product data from ${productUrl}:

Product Data:
- Title: ${rawData.title}
- Price: ${rawData.price}
- Description: ${rawData.description.substring(0, 200)}${rawData.description.length > 200 ? '...' : ''}

Images Found (${rawData.images.length} total):
${imageContext.map(img => `[${img.index}] ${img.url}\n     Context: ${img.context}`).join('\n\n')}

CRITICAL INSTRUCTIONS FOR IMAGE PRIORITIZATION:
1. The MAIN HERO/PRODUCT IMAGE should be FIRST in the images array
2. Prioritize images with HIGH PRIORITY, "in hero section", "appears early in page", large width (>500px)
3. EXCLUDE thumbnails (<300px), logos, icons, non-product images
4. Keep only the TOP 5 images
5. Convert any remaining relative URLs to absolute URLs (base: ${productUrl})

Please:
1. Validate all fields are present and reasonable
2. Prioritize main product hero image FIRST
3. Clean price formatting (valid format like "$XX.XX")
4. Improve description if too short or unclear (keep under 500 chars)
5. Ensure title is clean and readable

Return ONLY valid JSON:
{
  "title": "Product title",
  "price": "Product price",
  "description": "Product description",
  "images": ["main_hero_image_url", "product_image_2", "product_image_3", "product_image_4", "product_image_5"],
  "url": "${productUrl}"
}

No markdown, no code blocks, no explanations.`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await anthropicClient.messages.create({
    model: modelId,
    messages: [{ role: 'user', content: refinementPrompt }],
    max_tokens: 2000
  });

  if (response.usage) {
    totalInputTokens += response.usage.input_tokens || 0;
    totalOutputTokens += response.usage.output_tokens || 0;
  }

  let refinedData;
  try {
    const rawResponse = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      refinedData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found in response');
    }
  } catch (error) {
    console.error(`Error parsing ${modelId} refined data:`, error);
    refinedData = rawData;
  }

  const cost = calculateClaudeCost(modelId, totalInputTokens, totalOutputTokens);

  console.log(`${modelId} Refinement Complete:`, {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${cost.toFixed(6)}`,
    images_count: refinedData.images?.length || 0
  });

  return {
    productData: refinedData,
    refinementUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: cost
    }
  };
}

// Generic Claude email generation function (works for Sonnet, Haiku, etc.)
async function generateEmailWithClaude(template, productData, customPrompt, modelId) {
  const anthropicClient = getAnthropicClient();

  const generationPrompt = `Create an ecommerce promotional email using the following email template structure and the provided product data.

Email Template:
${template}

Product Data:
${JSON.stringify(productData, null, 2)}

${customPrompt ? `Additional Instructions: ${customPrompt}` : ''}

Return ONLY the complete HTML starting with <!DOCTYPE html> and ending with </html>.
- Use the product data to fill in the template
- Replace product titles, prices, images, and descriptions with the extracted data
- Preserve the template's structure and styling
- No markdown, no code blocks, no explanations`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await anthropicClient.messages.create({
    model: modelId,
    messages: [{ role: 'user', content: generationPrompt }],
    max_tokens: 16000
  });

  if (response.usage) {
    totalInputTokens += response.usage.input_tokens || 0;
    totalOutputTokens += response.usage.output_tokens || 0;
  }

  const rawResponse = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  const cost = calculateClaudeCost(modelId, totalInputTokens, totalOutputTokens);

  console.log(`${modelId} Generation Complete:`, {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${cost.toFixed(6)}`
  });

  return {
    content: rawResponse,
    generationUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: cost
    }
  };
}

// Generic Manual Extract + Claude Refine + Claude Generate pipeline
async function generateWithManualExtractClaudeRefineGenerate(productUrl, emailTemplate, customPrompt, modelId) {
  const modelName = modelId.includes('sonnet') ? 'Sonnet 4.5' : modelId.includes('haiku') ? 'Haiku 4.5' : modelId;
  console.log(`Starting hybrid approach: Manual extraction + ${modelName} refinement + ${modelName} generation`);

  // Step 1: Manual HTML extraction (free)
  let rawData;
  try {
    rawData = await extractProductDataManual(productUrl);
  } catch (error) {
    console.error('Manual extraction failed:', error);
    throw new Error(`Manual extraction failed: ${error.message}. Please try a different extraction method.`);
  }

  // Step 2: AI refinement with Claude model
  const { productData, refinementUsage } = await refineProductDataWithClaude(rawData, productUrl, modelId);

  // Step 3: Generate email with same Claude model
  const { content, generationUsage } = await generateEmailWithClaude(emailTemplate, productData, customPrompt, modelId);

  const totalUsage = {
    input_tokens: refinementUsage.input_tokens + generationUsage.input_tokens,
    output_tokens: refinementUsage.output_tokens + generationUsage.output_tokens,
    total_tokens: refinementUsage.total_tokens + generationUsage.total_tokens,
    estimated_cost_usd: refinementUsage.estimated_cost_usd + generationUsage.estimated_cost_usd,
    breakdown: {
      refinement: refinementUsage,
      generation: generationUsage
    }
  };

  console.log(`Manual Extract + ${modelName} Refine + Generate Complete:`, {
    total_cost: `$${totalUsage.estimated_cost_usd.toFixed(6)}`,
    refinement_cost: `$${refinementUsage.estimated_cost_usd.toFixed(6)}`,
    generation_cost: `$${generationUsage.estimated_cost_usd.toFixed(6)}`
  });

  return { content, usage: totalUsage };
}

// Hybrid approach: GPT-4o extracts, GPT-4o Mini generates
async function generateWithGPT4oExtractMiniGenerate(productUrl, emailTemplate, customPrompt, tools) {
  console.log('Starting hybrid approach: GPT-4o extraction + GPT-4o Mini generation');
  
  // Step 1: Extract product data with GPT-4o
  const { productData, extractionUsage } = await extractProductDataWithGPT4o(productUrl, tools);
  
  // Step 2: Generate email with GPT-4o Mini
  const { content, generationUsage } = await generateEmailWithMini(emailTemplate, productData, customPrompt);
  
  // Combine usage stats
  const totalUsage = {
    input_tokens: extractionUsage.input_tokens + generationUsage.input_tokens,
    output_tokens: extractionUsage.output_tokens + generationUsage.output_tokens,
    total_tokens: extractionUsage.total_tokens + generationUsage.total_tokens,
    estimated_cost_usd: extractionUsage.estimated_cost_usd + generationUsage.estimated_cost_usd,
    breakdown: {
      extraction: extractionUsage,
      generation: generationUsage
    }
  };

  console.log('Hybrid Approach Complete:', {
    total_cost: `$${totalUsage.estimated_cost_usd.toFixed(6)}`,
    extraction_cost: `$${extractionUsage.estimated_cost_usd.toFixed(6)}`,
    generation_cost: `$${generationUsage.estimated_cost_usd.toFixed(6)}`
  });

  return {
    content,
    usage: totalUsage
  };
}

// Hybrid approach: Claude Sonnet extracts (cheaper), GPT-4o Mini generates
async function generateWithClaudeSonnetExtractMiniGenerate(productUrl, emailTemplate, customPrompt, tools) {
  console.log('Starting hybrid approach: Claude Sonnet extraction + GPT-4o Mini generation');
  
  // Step 1: Extract product data with Claude Sonnet (cheaper than GPT-4o)
  const { productData, extractionUsage } = await extractProductDataWithClaudeSonnet(productUrl, tools);
  
  // Step 2: Generate email with GPT-4o Mini
  const { content, generationUsage } = await generateEmailWithMini(emailTemplate, productData, customPrompt);
  
  // Combine usage stats
  const totalUsage = {
    input_tokens: extractionUsage.input_tokens + generationUsage.input_tokens,
    output_tokens: extractionUsage.output_tokens + generationUsage.output_tokens,
    total_tokens: extractionUsage.total_tokens + generationUsage.total_tokens,
    estimated_cost_usd: extractionUsage.estimated_cost_usd + generationUsage.estimated_cost_usd,
    breakdown: {
      extraction: extractionUsage,
      generation: generationUsage
    }
  };

  console.log('Claude Sonnet Hybrid Approach Complete:', {
    total_cost: `$${totalUsage.estimated_cost_usd.toFixed(6)}`,
    extraction_cost: `$${extractionUsage.estimated_cost_usd.toFixed(6)}`,
    generation_cost: `$${generationUsage.estimated_cost_usd.toFixed(6)}`
  });

  return {
    content,
    usage: totalUsage
  };
}

// Hybrid approach: Manual extract + Mini refine + Mini generate (cheapest)
async function generateWithManualExtractMiniRefineGenerate(productUrl, emailTemplate, customPrompt) {
  console.log('Starting hybrid approach: Manual extraction + Mini refinement + Mini generation');
  
  // Step 1: Manual HTML extraction (free, server-side)
  let rawData;
  try {
    rawData = await extractProductDataManual(productUrl);
  } catch (error) {
    console.error('Manual extraction failed, cannot proceed:', error);
    throw new Error(`Manual extraction failed: ${error.message}. Please try a different extraction method.`);
  }
  
  // Step 2: AI refinement with GPT-4o Mini (small cost)
  const { productData, refinementUsage } = await refineProductDataWithMini(rawData, productUrl);
  
  // Step 3: Generate email with GPT-4o Mini
  const { content, generationUsage } = await generateEmailWithMini(emailTemplate, productData, customPrompt);
  
  // Combine usage stats
  const totalUsage = {
    input_tokens: refinementUsage.input_tokens + generationUsage.input_tokens,
    output_tokens: refinementUsage.output_tokens + generationUsage.output_tokens,
    total_tokens: refinementUsage.total_tokens + generationUsage.total_tokens,
    estimated_cost_usd: refinementUsage.estimated_cost_usd + generationUsage.estimated_cost_usd,
    breakdown: {
      refinement: refinementUsage,
      generation: generationUsage
    }
  };

  console.log('Manual Extract + Mini Refine + Generate Complete:', {
    total_cost: `$${totalUsage.estimated_cost_usd.toFixed(6)}`,
    refinement_cost: `$${refinementUsage.estimated_cost_usd.toFixed(6)}`,
    generation_cost: `$${generationUsage.estimated_cost_usd.toFixed(6)}`
  });

  return {
    content,
    usage: totalUsage
  };
}

// Refine extracted data using DeepSeek (V4 Flash or V4 Pro)
async function refineProductDataWithDeepSeek(rawData, productUrl, modelId) {
  const deepseekClient = getDeepSeekClient();

  const imageContext = rawData.images.map((img, index) => {
    const contextInfo = [];
    if (img.priority === 0) contextInfo.push('HIGHEST PRIORITY (og:image or JSON-LD - confirmed main product image)');
    else if (img.priority === 1) contextInfo.push('HIGH PRIORITY (hero/main/Shopify-CDN selector)');
    if (img.isInHero) contextInfo.push('in hero section');
    if (img.isInProductSection) contextInfo.push('in product section');
    if (img.isEarlyInPage) contextInfo.push('appears early in page');
    if (img.width && img.width > 500) contextInfo.push(`large (${img.width}px wide)`);
    if (img.context) contextInfo.push(`found via: ${img.context}`);

    return {
      url: img.url,
      index: index,
      context: contextInfo.join(', ') || 'general image',
      priority: img.priority,
      width: img.width
    };
  });

  const refinementPrompt = `Review and refine this extracted product data from ${productUrl}:

Product Data:
- Title: ${rawData.title}
- Price: ${rawData.price}
- Description: ${rawData.description.substring(0, 200)}${rawData.description.length > 200 ? '...' : ''}

Images Found (${rawData.images.length} total):
${imageContext.map(img => `[${img.index}] ${img.url}\n     Context: ${img.context}`).join('\n\n')}

CRITICAL INSTRUCTIONS FOR IMAGE PRIORITIZATION:
1. The MAIN HERO/PRODUCT IMAGE should be FIRST in the images array
2. Prioritize images with:
   - HIGHEST PRIORITY (priority 0) - these are from og:image or JSON-LD structured data, ALWAYS use these first as they are the confirmed main product image
   - HIGH PRIORITY (priority 1) - these were found using hero/main/Shopify-CDN selectors
   - "in hero section" - these are in the hero area
   - "appears early in page" - main images appear before description
   - Large width (>500px) - main product images are typically large
   - Images from cdn.shopify.com or /cdn/shop/ paths are actual product photos
   - Context containing "hero", "main", "primary", "shopify-main", "woocommerce-main"
3. EXCLUDE images that are:
   - Thumbnails (small width, <300px)
   - Logos or icons
   - Not product-related
4. Keep only the TOP 5 images (main hero + 4 best product images)
5. Convert any remaining relative URLs to absolute URLs (base: ${productUrl})

Please:
1. Validate all fields are present and reasonable
2. Prioritize main product hero image FIRST (use context clues above)
3. Clean price formatting (ensure it's a valid price format like "$XX.XX")
4. Improve description if it's too short or unclear (keep under 500 chars)
5. Ensure title is clean and readable

Return ONLY valid JSON in this exact format:
{
  "title": "Product title",
  "price": "Product price",
  "description": "Product description",
  "images": ["main_hero_image_url", "product_image_2", "product_image_3", "product_image_4", "product_image_5"],
  "url": "${productUrl}"
}

No markdown, no code blocks, no explanations.`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await deepseekClient.chat.completions.create({
    model: modelId,
    messages: [{ role: 'user', content: refinementPrompt }],
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  if (response.usage) {
    totalInputTokens += response.usage.prompt_tokens || 0;
    totalOutputTokens += response.usage.completion_tokens || 0;
  }

  let refinedData;
  try {
    const content = response.choices[0].message.content || '{}';
    refinedData = JSON.parse(content);
  } catch (error) {
    console.error(`Error parsing ${modelId} refined data:`, error);
    refinedData = rawData;
  }

  const refinementCost = calculateDeepSeekCost(modelId, totalInputTokens, totalOutputTokens);

  console.log(`${modelId} Refinement Complete:`, {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${parseFloat(refinementCost).toFixed(6)}`,
    images_count: refinedData.images?.length || 0
  });

  return {
    productData: refinedData,
    refinementUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: parseFloat(refinementCost)
    }
  };
}

// Generate email using DeepSeek (V4 Flash or V4 Pro) with extracted data
async function generateEmailWithDeepSeek(template, productData, customPrompt, modelId) {
  const deepseekClient = getDeepSeekClient();

  const generationPrompt = `Create an ecommerce promotional email using the following email template structure and the provided product data.

Email Template:
${template}

Product Data:
${JSON.stringify(productData, null, 2)}

${customPrompt ? `Additional Instructions: ${customPrompt}` : ''}

Return ONLY the complete HTML starting with <!DOCTYPE html> and ending with </html>.
- Use the product data to fill in the template
- Replace product titles, prices, images, and descriptions with the extracted data
- Preserve the template's structure and styling
- No markdown, no code blocks, no explanations`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await deepseekClient.chat.completions.create({
    model: modelId,
    messages: [{ role: 'user', content: generationPrompt }],
    max_tokens: 16000
  });

  if (response.usage) {
    totalInputTokens += response.usage.prompt_tokens || 0;
    totalOutputTokens += response.usage.completion_tokens || 0;
  }

  const rawResponse = response.choices[0].message.content || '';

  const generationCost = calculateDeepSeekCost(modelId, totalInputTokens, totalOutputTokens);

  console.log(`${modelId} Generation Complete:`, {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${parseFloat(generationCost).toFixed(6)}`
  });

  return {
    content: rawResponse,
    generationUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: parseFloat(generationCost)
    }
  };
}

// Generic Manual Extract + DeepSeek Refine + DeepSeek Generate pipeline
async function generateWithManualExtractDeepSeekRefineGenerate(productUrl, emailTemplate, customPrompt, modelId) {
  console.log(`Starting hybrid approach: Manual extraction + ${modelId} refinement + ${modelId} generation`);

  // Step 1: Manual HTML extraction (free)
  let rawData;
  try {
    rawData = await extractProductDataManual(productUrl);
  } catch (error) {
    console.error('Manual extraction failed:', error);
    throw new Error(`Manual extraction failed: ${error.message}. Please try a different extraction method.`);
  }

  // Step 2: AI refinement with DeepSeek
  const { productData, refinementUsage } = await refineProductDataWithDeepSeek(rawData, productUrl, modelId);

  // Step 3: Generate email with same DeepSeek model
  const { content, generationUsage } = await generateEmailWithDeepSeek(emailTemplate, productData, customPrompt, modelId);

  const totalUsage = {
    input_tokens: refinementUsage.input_tokens + generationUsage.input_tokens,
    output_tokens: refinementUsage.output_tokens + generationUsage.output_tokens,
    total_tokens: refinementUsage.total_tokens + generationUsage.total_tokens,
    estimated_cost_usd: refinementUsage.estimated_cost_usd + generationUsage.estimated_cost_usd,
    breakdown: {
      refinement: refinementUsage,
      generation: generationUsage
    }
  };

  console.log(`Manual Extract + ${modelId} Refine + Generate Complete:`, {
    total_cost: `$${totalUsage.estimated_cost_usd.toFixed(6)}`,
    refinement_cost: `$${refinementUsage.estimated_cost_usd.toFixed(6)}`,
    generation_cost: `$${generationUsage.estimated_cost_usd.toFixed(6)}`
  });

  return { content, usage: totalUsage };
}

// Refine extracted data using GPT-5 Mini
async function refineProductDataWith5Mini(rawData, productUrl) {
  const openaiClient = getOpenAIClient();

  const imageContext = rawData.images.map((img, index) => {
    const contextInfo = [];
    if (img.priority === 0) contextInfo.push('HIGHEST PRIORITY (og:image or JSON-LD - confirmed main product image)');
    else if (img.priority === 1) contextInfo.push('HIGH PRIORITY (hero/main/Shopify-CDN selector)');
    if (img.isInHero) contextInfo.push('in hero section');
    if (img.isInProductSection) contextInfo.push('in product section');
    if (img.isEarlyInPage) contextInfo.push('appears early in page');
    if (img.width && img.width > 500) contextInfo.push(`large (${img.width}px wide)`);
    if (img.context) contextInfo.push(`found via: ${img.context}`);

    return {
      url: img.url,
      index: index,
      context: contextInfo.join(', ') || 'general image',
      priority: img.priority,
      width: img.width
    };
  });

  const refinementPrompt = `Review and refine this extracted product data from ${productUrl}:

Product Data:
- Title: ${rawData.title}
- Price: ${rawData.price}
- Description: ${rawData.description.substring(0, 200)}${rawData.description.length > 200 ? '...' : ''}

Images Found (${rawData.images.length} total):
${imageContext.map(img => `[${img.index}] ${img.url}\n     Context: ${img.context}`).join('\n\n')}

CRITICAL INSTRUCTIONS FOR IMAGE PRIORITIZATION:
1. The MAIN HERO/PRODUCT IMAGE should be FIRST in the images array
2. Prioritize images with:
   - HIGHEST PRIORITY (priority 0) - these are from og:image or JSON-LD structured data, ALWAYS use these first as they are the confirmed main product image
   - HIGH PRIORITY (priority 1) - these were found using hero/main/Shopify-CDN selectors
   - "in hero section" - these are in the hero area
   - "appears early in page" - main images appear before description
   - Large width (>500px) - main product images are typically large
   - Images from cdn.shopify.com or /cdn/shop/ paths are actual product photos
   - Context containing "hero", "main", "primary", "shopify-main", "woocommerce-main"
3. EXCLUDE images that are:
   - Thumbnails (small width, <300px)
   - Logos or icons
   - Not product-related
4. Keep only the TOP 5 images (main hero + 4 best product images)
5. Convert any remaining relative URLs to absolute URLs (base: ${productUrl})

Please:
1. Validate all fields are present and reasonable
2. Prioritize main product hero image FIRST (use context clues above)
3. Clean price formatting (ensure it's a valid price format like "$XX.XX")
4. Improve description if it's too short or unclear (keep under 500 chars)
5. Ensure title is clean and readable

Return ONLY valid JSON in this exact format:
{
  "title": "Product title",
  "price": "Product price",
  "description": "Product description",
  "images": ["main_hero_image_url", "product_image_2", "product_image_3", "product_image_4", "product_image_5"],
  "url": "${productUrl}"
}

No markdown, no code blocks, no explanations.`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: refinementPrompt }],
    max_completion_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  if (response.usage) {
    totalInputTokens += response.usage.prompt_tokens || 0;
    totalOutputTokens += response.usage.completion_tokens || 0;
  }

  let refinedData;
  try {
    const content = response.choices[0].message.content || '{}';
    refinedData = JSON.parse(content);
  } catch (error) {
    console.error('Error parsing refined data:', error);
    refinedData = rawData;
  }

  const refinementCost = calculateOpenAICost('gpt-5-mini', totalInputTokens, totalOutputTokens);

  console.log('GPT-5 Mini Refinement Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: `$${parseFloat(refinementCost).toFixed(6)}`,
    images_count: refinedData.images?.length || 0
  });

  return {
    productData: refinedData,
    refinementUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: parseFloat(refinementCost)
    }
  };
}

// Generate email using GPT-5 Mini with extracted data
async function generateEmailWith5Mini(template, productData, customPrompt) {
  const openaiClient = getOpenAIClient();

  const generationPrompt = `Create an ecommerce promotional email using the following email template structure and the provided product data.

Email Template:
${template}

Product Data:
${JSON.stringify(productData, null, 2)}

${customPrompt ? `Additional Instructions: ${customPrompt}` : ''}

Return ONLY the complete HTML starting with <!DOCTYPE html> and ending with </html>.
- Use the product data to fill in the template
- Replace product titles, prices, images, and descriptions with the extracted data
- Preserve the template's structure and styling
- No markdown, no code blocks, no explanations`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: generationPrompt }],
    max_completion_tokens: 16000
  });

  if (response.usage) {
    totalInputTokens += response.usage.prompt_tokens || 0;
    totalOutputTokens += response.usage.completion_tokens || 0;
  }

  const rawResponse = response.choices[0].message.content || '';

  console.log('GPT-5 Mini Generation Complete:', {
    tokens_used: totalInputTokens + totalOutputTokens,
    cost: calculateOpenAICost('gpt-5-mini', totalInputTokens, totalOutputTokens)
  });

  return {
    content: rawResponse,
    generationUsage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost_usd: parseFloat(calculateOpenAICost('gpt-5-mini', totalInputTokens, totalOutputTokens))
    }
  };
}

// Hybrid approach: Manual extract + GPT-5 Mini refine + GPT-5 Mini generate
async function generateWithManualExtract5MiniRefineGenerate(productUrl, emailTemplate, customPrompt) {
  console.log('Starting hybrid approach: Manual extraction + GPT-5 Mini refinement + GPT-5 Mini generation');

  // Step 1: Manual HTML extraction (free, server-side)
  let rawData;
  try {
    rawData = await extractProductDataManual(productUrl);
  } catch (error) {
    console.error('Manual extraction failed, cannot proceed:', error);
    throw new Error(`Manual extraction failed: ${error.message}. Please try a different extraction method.`);
  }

  // Step 2: AI refinement with GPT-5 Mini
  const { productData, refinementUsage } = await refineProductDataWith5Mini(rawData, productUrl);

  // Step 3: Generate email with GPT-5 Mini
  const { content, generationUsage } = await generateEmailWith5Mini(emailTemplate, productData, customPrompt);

  // Combine usage stats
  const totalUsage = {
    input_tokens: refinementUsage.input_tokens + generationUsage.input_tokens,
    output_tokens: refinementUsage.output_tokens + generationUsage.output_tokens,
    total_tokens: refinementUsage.total_tokens + generationUsage.total_tokens,
    estimated_cost_usd: refinementUsage.estimated_cost_usd + generationUsage.estimated_cost_usd,
    breakdown: {
      refinement: refinementUsage,
      generation: generationUsage
    }
  };

  console.log('Manual Extract + GPT-5 Mini Refine + Generate Complete:', {
    total_cost: `$${totalUsage.estimated_cost_usd.toFixed(6)}`,
    refinement_cost: `$${refinementUsage.estimated_cost_usd.toFixed(6)}`,
    generation_cost: `$${generationUsage.estimated_cost_usd.toFixed(6)}`
  });

  return {
    content,
    usage: totalUsage
  };
}

// Hybrid approach: Manual extract + Opus 4.6 refine + Opus 4.6 generate
async function generateWithManualExtractOpusRefineGenerate(productUrl, emailTemplate, customPrompt) {
  console.log('Starting hybrid approach: Manual extraction + Opus 4.6 refinement + Opus 4.6 generation');

  // Step 1: Manual HTML extraction (free, server-side)
  let rawData;
  try {
    rawData = await extractProductDataManual(productUrl);
  } catch (error) {
    console.error('Manual extraction failed, cannot proceed:', error);
    throw new Error(`Manual extraction failed: ${error.message}. Please try a different extraction method.`);
  }

  // Step 2: AI refinement with Opus 4.6
  const { productData, refinementUsage } = await refineProductDataWithOpus(rawData, productUrl);

  // Step 3: Generate email with Opus 4.6
  const { content, generationUsage } = await generateEmailWithOpus(emailTemplate, productData, customPrompt);

  // Combine usage stats
  const totalUsage = {
    input_tokens: refinementUsage.input_tokens + generationUsage.input_tokens,
    output_tokens: refinementUsage.output_tokens + generationUsage.output_tokens,
    total_tokens: refinementUsage.total_tokens + generationUsage.total_tokens,
    estimated_cost_usd: refinementUsage.estimated_cost_usd + generationUsage.estimated_cost_usd,
    breakdown: {
      refinement: refinementUsage,
      generation: generationUsage
    }
  };

  console.log('Manual Extract + Opus 4.6 Refine + Generate Complete:', {
    total_cost: `$${totalUsage.estimated_cost_usd.toFixed(6)}`,
    refinement_cost: `$${refinementUsage.estimated_cost_usd.toFixed(6)}`,
    generation_cost: `$${generationUsage.estimated_cost_usd.toFixed(6)}`
  });

  return {
    content,
    usage: totalUsage
  };
}

// Hybrid approach: Claude Haiku extracts (cheapest), GPT-4o Mini generates
async function generateWithClaudeHaikuExtractMiniGenerate(productUrl, emailTemplate, customPrompt, tools) {
  console.log('Starting hybrid approach: Claude Haiku extraction + GPT-4o Mini generation');
  
  // Step 1: Extract product data with Claude Haiku (cheapest option)
  const { productData, extractionUsage } = await extractProductDataWithClaudeHaiku(productUrl, tools);
  
  // Step 2: Generate email with GPT-4o Mini
  const { content, generationUsage } = await generateEmailWithMini(emailTemplate, productData, customPrompt);
  
  // Combine usage stats
  const totalUsage = {
    input_tokens: extractionUsage.input_tokens + generationUsage.input_tokens,
    output_tokens: extractionUsage.output_tokens + generationUsage.output_tokens,
    total_tokens: extractionUsage.total_tokens + generationUsage.total_tokens,
    estimated_cost_usd: extractionUsage.estimated_cost_usd + generationUsage.estimated_cost_usd,
    breakdown: {
      extraction: extractionUsage,
      generation: generationUsage
    }
  };

  console.log('Claude Haiku Hybrid Approach Complete:', {
    total_cost: `$${totalUsage.estimated_cost_usd.toFixed(6)}`,
    extraction_cost: `$${extractionUsage.estimated_cost_usd.toFixed(6)}`,
    generation_cost: `$${generationUsage.estimated_cost_usd.toFixed(6)}`
  });

  return {
    content,
    usage: totalUsage
  };
}

// Route to appropriate model handler based on provider
async function generateWithModel(model, prompt, tools, productUrl = null, emailTemplate = null, customPrompt = null) {
  const modelConfig = getModelConfig(model);

  if (modelConfig.provider === 'anthropic') {
    return await generateWithClaude(prompt, modelConfig, tools);
  } else if (modelConfig.provider === 'openai') {
    const result = await generateWithOpenAI(prompt, modelConfig);
    // OpenAI now returns { content, usage } format
    return result;
  } else if (modelConfig.provider === 'openai-hybrid') {
    // Hybrid approach: GPT-4o extracts, Mini generates
    if (!productUrl || !emailTemplate) {
      throw new Error('Product URL and email template are required for hybrid approach');
    }
    return await generateWithGPT4oExtractMiniGenerate(productUrl, emailTemplate, customPrompt || '', tools);
  } else if (modelConfig.provider === 'claude-hybrid') {
    // Hybrid approach: Claude extracts (Sonnet or Haiku), Mini generates
    if (!productUrl || !emailTemplate) {
      throw new Error('Product URL and email template are required for hybrid approach');
    }
    // Route to appropriate extraction function based on model
    if (model === 'claude-haiku-extract-mini-generate') {
      return await generateWithClaudeHaikuExtractMiniGenerate(productUrl, emailTemplate, customPrompt || '', tools);
    } else {
      return await generateWithClaudeSonnetExtractMiniGenerate(productUrl, emailTemplate, customPrompt || '', tools);
    }
  } else if (modelConfig.provider === 'manual-hybrid') {
    // Hybrid approach: Manual extract + Mini refine + Mini generate
    if (!productUrl || !emailTemplate) {
      throw new Error('Product URL and email template are required for hybrid approach');
    }
    return await generateWithManualExtractMiniRefineGenerate(productUrl, emailTemplate, customPrompt || '');
  } else if (modelConfig.provider === 'manual-5-mini-hybrid') {
    // Hybrid approach: Manual extract + GPT-5 Mini refine + GPT-5 Mini generate
    if (!productUrl || !emailTemplate) {
      throw new Error('Product URL and email template are required for hybrid approach');
    }
    return await generateWithManualExtract5MiniRefineGenerate(productUrl, emailTemplate, customPrompt || '');
  } else if (modelConfig.provider === 'manual-opus-hybrid') {
    // Hybrid approach: Manual extract + Opus 4.6 refine + Opus 4.6 generate
    if (!productUrl || !emailTemplate) {
      throw new Error('Product URL and email template are required for hybrid approach');
    }
    return await generateWithManualExtractOpusRefineGenerate(productUrl, emailTemplate, customPrompt || '');
  } else if (modelConfig.provider === 'manual-sonnet-hybrid' || modelConfig.provider === 'manual-haiku-hybrid') {
    // Hybrid approach: Manual extract + Sonnet/Haiku refine + generate
    if (!productUrl || !emailTemplate) {
      throw new Error('Product URL and email template are required for hybrid approach');
    }
    return await generateWithManualExtractClaudeRefineGenerate(productUrl, emailTemplate, customPrompt || '', modelConfig.refineModelId);
  } else if (modelConfig.provider === 'manual-deepseek-hybrid') {
    // Hybrid approach: Manual extract + DeepSeek refine + generate (V4 Flash or V4 Pro)
    if (!productUrl || !emailTemplate) {
      throw new Error('Product URL and email template are required for hybrid approach');
    }
    return await generateWithManualExtractDeepSeekRefineGenerate(productUrl, emailTemplate, customPrompt || '', modelConfig.refineModelId);
  } else {
    throw new Error(`Unsupported provider: ${modelConfig.provider}`);
  }
}

// Extract clean HTML from Claude's response
function extractHtml(text) {
  // If wrapped in ```html ... ``` code blocks
  const codeBlockMatch = text.match(/```html\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // If wrapped in ``` ... ``` without language
  const genericCodeBlock = text.match(/```\s*(<!DOCTYPE[\s\S]*?<\/html>)\s*```/i);
  if (genericCodeBlock) {
    return genericCodeBlock[1].trim();
  }

  // Find HTML directly (from <!DOCTYPE to </html>)
  const htmlMatch = text.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
  if (htmlMatch) {
    return htmlMatch[1].trim();
  }

  return text.trim();
}

export async function POST(request) {
  try {
    const { productUrl, emailTemplate, customPrompt, model } = await request.json();

    // Validate model parameter
    const validModels = ['claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5', 'gpt-4o', 'gpt-4o-mini', 'gpt-4o-extract-mini-generate', 'claude-sonnet-extract-mini-generate', 'claude-haiku-extract-mini-generate', 'manual-extract-mini-refine-generate', 'manual-extract-5-mini-refine-generate', 'manual-extract-opus-refine-generate', 'manual-extract-sonnet-refine-generate', 'manual-extract-haiku-refine-generate', 'manual-extract-deepseek-flash-refine-generate', 'manual-extract-deepseek-pro-refine-generate'];
    const selectedModel = model || 'claude-opus-4-5'; // Default to Claude Opus for backward compatibility
    
    if (!validModels.includes(selectedModel)) {
      return Response.json({ 
        error: `Invalid model. Must be one of: ${validModels.join(', ')}` 
      }, { status: 400 });
    }

    // Validate productUrl
    if (!productUrl || typeof productUrl !== 'string' || !productUrl.trim()) {
      return Response.json({ 
        error: 'Product URL is required and must be a non-empty string' 
      }, { status: 400 });
    }

    if (!isValidUrl(productUrl.trim())) {
      return Response.json({ 
        error: 'Product URL must be a valid HTTP or HTTPS URL' 
      }, { status: 400 });
    }

    // Validate emailTemplate
    if (!emailTemplate || typeof emailTemplate !== 'string' || !emailTemplate.trim()) {
      return Response.json({ 
        error: 'Email template is required and must be a non-empty HTML string' 
      }, { status: 400 });
    }

    if (!isValidHtml(emailTemplate.trim())) {
      return Response.json({ 
        error: 'Email template must be valid HTML. It should contain HTML tags and either a DOCTYPE declaration or html tag structure.' 
      }, { status: 400 });
    }

    // Validate customPrompt (optional but must exist)
    if (customPrompt === undefined || customPrompt === null) {
      return Response.json({ 
        error: 'Custom prompt field is required (can be empty string)' 
      }, { status: 400 });
    }

    if (typeof customPrompt !== 'string') {
      return Response.json({ 
        error: 'Custom prompt must be a string' 
      }, { status: 400 });
    }

    // Check API keys based on selected model
    const modelConfig = getModelConfig(selectedModel);
    
    // Check OpenAI key - environment variable only
    if (modelConfig.provider === 'openai' || modelConfig.provider === 'openai-hybrid' || modelConfig.provider === 'manual-hybrid' || modelConfig.provider === 'manual-5-mini-hybrid') {
      if (!process.env.OPENAI_API_KEY) {
        return Response.json({ 
          error: 'OpenAI API key is required but not configured. Please add OPENAI_API_KEY to your environment variables or .env.local file.' 
        }, { status: 500 });
      }
    }

    // Check Anthropic key - environment variable only
    if (modelConfig.provider === 'anthropic' || modelConfig.provider === 'claude-hybrid' || modelConfig.provider === 'manual-opus-hybrid' || modelConfig.provider === 'manual-sonnet-hybrid' || modelConfig.provider === 'manual-haiku-hybrid') {
      if (!process.env.ANTHROPIC_API_KEY) {
        return Response.json({ 
          error: 'Anthropic API key is required but not configured. Please add ANTHROPIC_API_KEY to your environment variables or .env.local file.' 
        }, { status: 500 });
      }
    }

    // Check DeepSeek key for DeepSeek hybrid models
    if (modelConfig.provider === 'manual-deepseek-hybrid') {
      if (!process.env.DEEPSEEK_API_KEY) {
        return Response.json({
          error: 'DeepSeek API key is required but not configured. Please add DEEPSEEK_API_KEY to your environment variables or .env.local file.'
        }, { status: 500 });
      }
    }

    // Check if hybrid models need both keys
    if (modelConfig.provider === 'claude-hybrid') {
      // Claude hybrid needs both Anthropic (extraction) and OpenAI (generation)
      if (!process.env.OPENAI_API_KEY) {
        return Response.json({ 
          error: 'OpenAI API key is required for Claude Sonnet Extract + Mini Generate. Please add OPENAI_API_KEY to your environment variables or .env.local file.' 
        }, { status: 500 });
      }
    }

    // Build the prompt (not used for hybrid approach, but needed for others)
    const prompt = buildPrompt(productUrl, emailTemplate, customPrompt);

    // Generate with selected model
    // For hybrid approach, pass additional params; for others, just prompt and tools
    const isHybridModel = selectedModel === 'gpt-4o-extract-mini-generate' || selectedModel === 'claude-sonnet-extract-mini-generate' || selectedModel === 'claude-haiku-extract-mini-generate' || selectedModel === 'manual-extract-mini-refine-generate' || selectedModel === 'manual-extract-5-mini-refine-generate' || selectedModel === 'manual-extract-opus-refine-generate' || selectedModel === 'manual-extract-sonnet-refine-generate' || selectedModel === 'manual-extract-haiku-refine-generate' || selectedModel === 'manual-extract-deepseek-flash-refine-generate' || selectedModel === 'manual-extract-deepseek-pro-refine-generate';
    const result = isHybridModel
      ? await generateWithModel(selectedModel, prompt, tools, productUrl, emailTemplate, customPrompt)
      : await generateWithModel(selectedModel, prompt, tools);
    const rawResponse = result.content;

    // Extract and clean HTML from response
    const emailHtml = extractHtml(rawResponse);

    if (!emailHtml || emailHtml.length < 100) {
      return Response.json({ 
        error: 'Failed to generate valid email HTML. The response was too short or invalid.' 
      }, { status: 500 });
    }

    // Return response with token usage if available
    return Response.json({ 
      success: true, 
      content: emailHtml,
      usage: result.usage || null
    });

  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ 
      error: error.message || 'Failed to generate email' 
    }, { status: 500 });
  }
}

