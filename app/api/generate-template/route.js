import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';

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
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 } // per 1K tokens
  };
  
  const modelPricing = pricing[modelId] || pricing['gpt-4o-mini'];
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
    
    // Extract title - try multiple selectors
    let title = '';
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
        title = $(selector).attr('content') || $(selector).attr('property') || '';
      } else {
        title = $(selector).first().text().trim();
      }
      if (title) break;
    }
    
    // Extract price - try multiple selectors
    let price = '';
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
      price = $(selector).first().text().trim() || $(selector).attr('data-price') || '';
      if (price) {
        // Clean price (remove currency symbols, keep numbers and decimal)
        price = price.replace(/[^\d.,]/g, '').trim();
        break;
      }
    }
    
    // Extract images with context - prioritize hero/main images
    const imagesWithContext = [];
    const seenUrls = new Set();
    
    // Priority 1: Hero/Main product image selectors (highest priority)
    const heroImageSelectors = [
      { selector: '.hero img', priority: 1, context: 'hero-section' },
      { selector: '.product-hero img', priority: 1, context: 'product-hero' },
      { selector: '.main-image', priority: 1, context: 'main-image' },
      { selector: 'img[data-main-image]', priority: 1, context: 'data-main-image' },
      { selector: 'img[data-product-image="main"]', priority: 1, context: 'main-product-image' },
      { selector: '.product__media img:first-child', priority: 1, context: 'shopify-main' },
      { selector: '.product-single__media img:first-child', priority: 1, context: 'shopify-main' },
      { selector: '.woocommerce-product-gallery img:first-child', priority: 1, context: 'woocommerce-main' }
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
    
    // Extract images with priority and context
    const allSelectors = [...heroImageSelectors, ...productImageSelectors];
    
    for (const { selector, priority, context } of allSelectors) {
      $(selector).each((i, el) => {
        const $el = $(el);
        const src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('data-original') || '';
        
        if (!src || seenUrls.has(src)) return;
        
        // Filter out logos, icons, thumbnails
        const srcLower = src.toLowerCase();
        const altLower = ($el.attr('alt') || '').toLowerCase();
        const classLower = ($el.attr('class') || '').toLowerCase();
        
        if (srcLower.includes('logo') || srcLower.includes('icon') || 
            altLower.includes('logo') || classLower.includes('logo') ||
            srcLower.includes('avatar') || srcLower.includes('thumbnail') ||
            srcLower.includes('badge') || srcLower.includes('flag')) {
          return;
        }
        
        // Get image dimensions from HTML attributes
        const width = parseInt($el.attr('width') || $el.attr('data-width') || '0');
        const height = parseInt($el.attr('height') || $el.attr('data-height') || '0');
        
        // Check if image is in hero section
        const isInHero = $el.closest('.hero, .product-hero, .banner, .hero-section').length > 0;
        const isInProductSection = $el.closest('.product, .product-details, .product-info, [data-product]').length > 0;
        
        // Calculate position (earlier = better for hero images)
        const htmlPosition = html.indexOf(src);
        const isEarlyInPage = htmlPosition < html.length * 0.3; // First 30% of HTML
        
        imagesWithContext.push({
          url: src,
          priority: priority,
          context: context,
          width: width || null,
          height: height || null,
          isInHero: isInHero,
          isInProductSection: isInProductSection,
          isEarlyInPage: isEarlyInPage,
          position: htmlPosition
        });
        
        seenUrls.add(src);
      });
    }
    
    // If no images found with selectors, try general fallback
    if (imagesWithContext.length === 0) {
      $(generalImageSelectors[0].selector).each((i, el) => {
        const $el = $(el);
        const src = $el.attr('src') || $el.attr('data-src') || '';
        
        if (!src || seenUrls.has(src) || !src.startsWith('http')) return;
        
        const srcLower = src.toLowerCase();
        if (srcLower.includes('logo') || srcLower.includes('icon')) return;
        
        imagesWithContext.push({
          url: src,
          priority: 3,
          context: 'general-fallback',
          width: null,
          height: null,
          isInHero: false,
          isInProductSection: false,
          isEarlyInPage: false,
          position: html.indexOf(src)
        });
        
        seenUrls.add(src);
      });
    }
    
    // Sort by priority, then by position (earlier = better)
    imagesWithContext.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.position - b.position;
    });
    
    // Limit to top 15 images (will be refined by AI)
    const limitedImagesWithContext = imagesWithContext.slice(0, 15);
    
    // Extract description - try multiple selectors
    let description = '';
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
      hero_images: rawData.images.filter(img => img.priority === 1 || img.isInHero).length,
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
    if (img.priority === 1) contextInfo.push('HIGH PRIORITY (hero/main selector)');
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
   - HIGH PRIORITY (priority 1) - these were found using hero/main selectors
   - "in hero section" - these are in the hero area
   - "appears early in page" - main images appear before description
   - Large width (>500px) - main product images are typically large
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
    const validModels = ['claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5', 'gpt-4o', 'gpt-4o-mini', 'gpt-4o-extract-mini-generate', 'claude-sonnet-extract-mini-generate', 'claude-haiku-extract-mini-generate', 'manual-extract-mini-refine-generate'];
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
    if (modelConfig.provider === 'openai' || modelConfig.provider === 'openai-hybrid' || modelConfig.provider === 'manual-hybrid') {
      if (!process.env.OPENAI_API_KEY) {
        return Response.json({ 
          error: 'OpenAI API key is required but not configured. Please add OPENAI_API_KEY to your environment variables or .env.local file.' 
        }, { status: 500 });
      }
    }

    // Check Anthropic key - environment variable only
    if (modelConfig.provider === 'anthropic' || modelConfig.provider === 'claude-hybrid') {
      if (!process.env.ANTHROPIC_API_KEY) {
        return Response.json({ 
          error: 'Anthropic API key is required but not configured. Please add ANTHROPIC_API_KEY to your environment variables or .env.local file.' 
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
    const isHybridModel = selectedModel === 'gpt-4o-extract-mini-generate' || selectedModel === 'claude-sonnet-extract-mini-generate' || selectedModel === 'claude-haiku-extract-mini-generate' || selectedModel === 'manual-extract-mini-refine-generate';
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

