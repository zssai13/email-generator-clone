import OpenAI from 'openai';

// Initialize OpenAI client lazily
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable.');
  }

  return new OpenAI({ apiKey });
}

// Model configuration for GPT-5.2 series
function getModelConfig(model) {
  const configs = {
    'gpt-5.2': {
      modelId: 'gpt-5.2',
      maxOutputTokens: 4000
    },
    'gpt-5.2-pro': {
      modelId: 'gpt-5.2-pro',
      maxOutputTokens: 4000
    }
  };
  return configs[model] || configs['gpt-5.2'];
}

// Build the input prompt from all components
function buildTextEmailInput(businessInfo, guidelines, systemPrompt, userPrompt) {
  let input = '';

  // Add system prompt if provided
  if (systemPrompt && systemPrompt.trim()) {
    input += `## Instructions\n${systemPrompt.trim()}\n\n`;
  }

  // Add business context
  input += `## Business Context (RAG Data)\n${businessInfo.trim()}\n\n`;

  // Add email guidelines
  input += `## Email Guidelines & Templates\n${guidelines.trim()}\n\n`;

  // Add user task
  input += `## Your Task\n${userPrompt.trim()}\n\n`;

  // Add output instructions
  input += `Generate a complete plain text email including the Subject line at the top.
Format the output exactly like this:
Subject: [Your subject line here]

[Email body here]

The email should be ready to copy and paste directly into an email client.`;

  return input;
}

// Calculate cost based on model and usage
function calculateCost(modelId, usage) {
  // Placeholder pricing - update with actual GPT-5.2 pricing when available
  const pricing = {
    'gpt-5.2': { input: 0.002, output: 0.008 },      // per 1K tokens
    'gpt-5.2-pro': { input: 0.010, output: 0.040 }   // per 1K tokens
  };

  const modelPricing = pricing[modelId] || pricing['gpt-5.2'];
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;

  const inputCost = (inputTokens / 1000) * modelPricing.input;
  const outputCost = (outputTokens / 1000) * modelPricing.output;

  return inputCost + outputCost;
}

// Generate text email using OpenAI Responses API
async function generateTextEmail(openaiClient, config, input) {
  const startTime = Date.now();

  // Use the new Responses API
  const response = await openaiClient.responses.create({
    model: config.modelId,
    input: input,
    max_output_tokens: config.maxOutputTokens
  });

  const generationTimeMs = Date.now() - startTime;

  // Extract usage data
  const usage = {
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
    total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    estimated_cost_usd: calculateCost(config.modelId, response.usage),
    generation_time_ms: generationTimeMs
  };

  console.log('Text Email Generation Complete:', {
    model: config.modelId,
    tokens: usage.total_tokens,
    cost: `$${usage.estimated_cost_usd.toFixed(6)}`,
    time: `${generationTimeMs}ms`
  });

  return {
    content: response.output_text,
    usage
  };
}

// Validate markdown content
function isValidMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }
  // Basic validation - ensure it has some content
  return content.trim().length > 0;
}

export async function POST(request) {
  try {
    const { businessInfo, emailGuidelines, systemPrompt, userPrompt, model } = await request.json();

    // Validate model
    const validModels = ['gpt-5.2', 'gpt-5.2-pro'];
    const selectedModel = model || 'gpt-5.2';

    if (!validModels.includes(selectedModel)) {
      return Response.json({
        error: `Invalid model. Must be one of: ${validModels.join(', ')}`
      }, { status: 400 });
    }

    // Validate businessInfo (required)
    if (!businessInfo || typeof businessInfo !== 'string' || !businessInfo.trim()) {
      return Response.json({
        error: 'Business Info RAG data is required. Please upload a markdown file.'
      }, { status: 400 });
    }

    if (!isValidMarkdown(businessInfo)) {
      return Response.json({
        error: 'Business Info must be valid markdown content.'
      }, { status: 400 });
    }

    // Validate emailGuidelines (required)
    if (!emailGuidelines || typeof emailGuidelines !== 'string' || !emailGuidelines.trim()) {
      return Response.json({
        error: 'Email Guidelines are required. Please upload a markdown file.'
      }, { status: 400 });
    }

    if (!isValidMarkdown(emailGuidelines)) {
      return Response.json({
        error: 'Email Guidelines must be valid markdown content.'
      }, { status: 400 });
    }

    // Validate systemPrompt (optional, can be empty)
    if (systemPrompt !== undefined && systemPrompt !== null && typeof systemPrompt !== 'string') {
      return Response.json({
        error: 'System prompt must be a string.'
      }, { status: 400 });
    }

    // Validate userPrompt (required for generation)
    if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
      return Response.json({
        error: 'User prompt is required. Please enter what email you want to generate.'
      }, { status: 400 });
    }

    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({
        error: 'OpenAI API key is required but not configured. Please add OPENAI_API_KEY to your environment variables.'
      }, { status: 500 });
    }

    // Get OpenAI client and model config
    const openaiClient = getOpenAIClient();
    const modelConfig = getModelConfig(selectedModel);

    // Build the input prompt
    const input = buildTextEmailInput(
      businessInfo,
      emailGuidelines,
      systemPrompt || '',
      userPrompt
    );

    // Generate the email
    const result = await generateTextEmail(openaiClient, modelConfig, input);

    // Validate output
    if (!result.content || result.content.trim().length < 10) {
      return Response.json({
        error: 'Failed to generate email. The response was empty or too short.'
      }, { status: 500 });
    }

    return Response.json({
      success: true,
      content: result.content,
      usage: result.usage
    });

  } catch (error) {
    console.error('Text Email API Error:', error);

    // Handle specific OpenAI errors
    if (error.message?.includes('API key')) {
      return Response.json({
        error: 'OpenAI API key error. Please check your API key configuration.'
      }, { status: 500 });
    }

    if (error.message?.includes('model')) {
      return Response.json({
        error: `Model error: ${error.message}. The GPT-5.2 models may not be available yet.`
      }, { status: 500 });
    }

    return Response.json({
      error: error.message || 'Failed to generate email'
    }, { status: 500 });
  }
}
