import Anthropic from '@anthropic-ai/sdk';

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

// Execute the fetch tool when Claude calls it - returns { result, diagnostics }
async function executeTool(toolName, toolInput) {
  if (toolName === "fetch_url") {
    const diagnostics = { url: toolInput.url };
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
      diagnostics.wasTruncated = html.length > 100000;
      diagnostics.htmlPreview = html.substring(0, 500);
      return { result: html.substring(0, 100000), diagnostics };
    } catch (error) {
      diagnostics.error = error.message;
      return { result: `Error fetching URL: ${error.message}`, diagnostics };
    }
  }
  return { result: "Unknown tool", diagnostics: { error: "Unknown tool" } };
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

// Format the generation log as human-readable plain text
function formatLog(log) {
  let output = '';
  output += '========================================\n';
  output += 'EMAIL GENERATOR - DIAGNOSTIC LOG\n';
  output += '========================================\n';
  output += `Timestamp: ${log.timestamp}\n`;
  output += `Product URL: ${log.productUrl}\n`;
  output += `Custom Prompt: ${log.customPrompt}\n`;
  output += '\n';

  output += '--- PROMPT SENT TO CLAUDE ---\n';
  output += `${log.promptSent}\n`;
  output += '\n';

  if (log.toolCalls.length > 0) {
    for (const call of log.toolCalls) {
      output += `--- TOOL CALL #${call.iteration} ---\n`;
      output += `Tool: ${call.toolName}\n`;
      output += `URL Fetched: ${call.url || '(none)'}\n`;
      if (call.httpStatus !== undefined) {
        output += `HTTP Status: ${call.httpStatus}\n`;
      }
      if (call.htmlSizeChars !== undefined) {
        output += `HTML Size: ${call.htmlSizeChars.toLocaleString()} characters\n`;
        output += `Truncated: ${call.wasTruncated ? 'Yes (over 100KB limit)' : 'No'}\n`;
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

export async function POST(request) {
  // Initialize diagnostic log
  const generationLog = {
    timestamp: new Date().toISOString(),
    productUrl: '',
    customPrompt: '(none)',
    promptSent: '',
    toolCalls: [],
    claudeTextBlocks: [],
    finalOutput: { htmlLength: 0, parseSuccess: false },
    tokenUsage: null,
    errors: []
  };

  try {
    const { productUrl, customPrompt } = await request.json();

    generationLog.productUrl = productUrl || '';
    generationLog.customPrompt = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : '(none)';

    if (!productUrl) {
      generationLog.errors.push('Product URL is required');
      return Response.json({ error: 'Product URL is required', diagnosticLog: formatLog(generationLog) }, { status: 400 });
    }

    // Build the prompt with optional custom instructions
    let promptContent = `Create a beautiful promotional ecommerce email for this product: ${productUrl}`;

    // Add custom prompt if provided
    if (customPrompt && customPrompt.trim()) {
      promptContent += `\n\nAdditional instructions: ${customPrompt.trim()}`;
    }

    promptContent += `\n\nReturn ONLY the complete HTML starting with <!DOCTYPE html> and ending with </html>. No markdown, no code blocks, no explanations.`;

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
      model: 'claude-opus-4-5-20251101',
      max_tokens: 16000,
      tools,
      messages
    });

    // Track tokens from initial call
    if (response.usage) {
      totalInputTokens += response.usage.input_tokens || 0;
      totalOutputTokens += response.usage.output_tokens || 0;
    }

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(block => block.type === 'tool_use');
      if (!toolUseBlock) break;

      // Capture any text blocks Claude produced in this response
      response.content
        .filter(block => block.type === 'text' && block.text.trim())
        .forEach(block => {
          generationLog.claudeTextBlocks.push(block.text.substring(0, 1000));
        });

      const { result: toolResult, diagnostics } = await executeTool(toolUseBlock.name, toolUseBlock.input);

      // Record tool call diagnostics
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
        model: 'claude-opus-4-5-20251101',
        max_tokens: 16000,
        tools,
        messages
      });

      // Track tokens from subsequent calls
      if (response.usage) {
        totalInputTokens += response.usage.input_tokens || 0;
        totalOutputTokens += response.usage.output_tokens || 0;
      }
    }

    // Record token usage
    generationLog.tokenUsage = {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens
    };

    // Extract and clean HTML
    const rawResponse = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    const emailHtml = extractHtml(rawResponse);

    // Record final output info
    generationLog.finalOutput = {
      htmlLength: emailHtml.length,
      parseSuccess: /^<!DOCTYPE/i.test(emailHtml) || /^<html/i.test(emailHtml)
    };

    return Response.json({
      success: true,
      content: emailHtml,
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
