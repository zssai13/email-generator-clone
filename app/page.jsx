'use client';

import { useState } from 'react';

export default function Home() {
  const [activeTab, setActiveTab] = useState('generator');
  const [productUrl, setProductUrl] = useState('');
  const [emailCount, setEmailCount] = useState('2');
  const [promotion, setPromotion] = useState('');
  const [customPromptTab1, setCustomPromptTab1] = useState('');
  const [fetchMethod, setFetchMethod] = useState('standard');
  const [loading, setLoading] = useState(false);
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');
  const [productData, setProductData] = useState(null);
  const [diagnosticLog, setDiagnosticLog] = useState(null);
  
  // State for Tab 2: Template-based email generator
  const [templateProductUrl, setTemplateProductUrl] = useState('');
  const [emailTemplateFile, setEmailTemplateFile] = useState(null);
  const [emailTemplateContent, setEmailTemplateContent] = useState('');
  const [templateFileName, setTemplateFileName] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState('claude-opus-4-5');
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateStatus, setTemplateStatus] = useState('');
  const [generatedTemplateEmail, setGeneratedTemplateEmail] = useState(null);
  const [templateCopied, setTemplateCopied] = useState(false);
  const [templateUsage, setTemplateUsage] = useState(null);

  // State for Tab 3: Text Email Generator
  const [textEmailModel, setTextEmailModel] = useState('gpt-5.2');
  const [businessInfoContent, setBusinessInfoContent] = useState('');
  const [businessInfoFileName, setBusinessInfoFileName] = useState('');
  const [guidelinesContent, setGuidelinesContent] = useState('');
  const [guidelinesFileName, setGuidelinesFileName] = useState('');
  const [textEmailSystemPrompt, setTextEmailSystemPrompt] = useState('');
  const [textEmailUserPrompt, setTextEmailUserPrompt] = useState('');
  const [textEmailLoading, setTextEmailLoading] = useState(false);
  const [textEmailError, setTextEmailError] = useState('');
  const [textEmailStatus, setTextEmailStatus] = useState('');
  const [generatedTextEmail, setGeneratedTextEmail] = useState(null);
  const [textEmailUsage, setTextEmailUsage] = useState(null);
  const [textEmailCopied, setTextEmailCopied] = useState(false);

  // Model options for Tab 2 dropdown
  const modelOptions = [
    { value: 'claude-opus-4-5', label: 'Claude Opus 4.5', provider: 'anthropic' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic' },
    { value: 'gpt-4o', label: 'ChatGPT-4o', provider: 'openai' },
    { value: 'gpt-4o-mini', label: 'ChatGPT-4o Mini', provider: 'openai' },
    { value: 'gpt-4o-extract-mini-generate', label: 'GPT-4o Extract + Mini Generate', provider: 'openai-hybrid' },
    { value: 'claude-sonnet-extract-mini-generate', label: 'Claude Sonnet Extract + Mini Generate', provider: 'claude-hybrid' },
    { value: 'claude-haiku-extract-mini-generate', label: 'Claude Haiku Extract + Mini Generate', provider: 'claude-hybrid' },
    { value: 'manual-extract-mini-refine-generate', label: 'Manual Extract + Mini Refine + Generate (Cheapest)', provider: 'manual-hybrid' }
  ];

  // Model options for Tab 3 (Text Email Generator)
  const textEmailModelOptions = [
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.2-pro', label: 'GPT-5.2 Pro' },
    { value: 'grok-4-1-fast', label: 'Grok 4.1 Fast (Reasoning)' }
  ];

  const parseEmails = (text) => {
    let blocks = text.split(/<!-- ?EMAIL_SEPARATOR ?-->/gi)
      .filter(block => block.includes('<!DOCTYPE html>') || block.includes('<!doctype html>'));
    
    if (blocks.length === 0) {
      const htmlMatches = text.match(/<\!DOCTYPE html>[\s\S]*?<\/html>/gi);
      if (htmlMatches) blocks = htmlMatches;
    }

    return blocks.map((block, index) => {
      const styleMatch = block.match(/<!-- ?(MINIMAL LUXURY|TROPICAL VIBRANT|EDITORIAL|MAGAZINE|PLAYFUL FRESH|[\w\s]+) ?-->/i);
      let styleName = styleMatch ? styleMatch[1].trim() : `Style ${index + 1}`;
      
      const htmlMatch = block.match(/(<\!DOCTYPE html>[\s\S]*<\/html>)/i);
      const html = htmlMatch ? htmlMatch[1].trim() : block.trim();
      
      return { id: index + 1, description: styleName, html };
    }).filter(e => e.html.length > 100);
  };

  const generateEmails = async () => {
    if (!productUrl.trim()) {
      setError('Please enter a product URL');
      return;
    }

    setLoading(true);
    setError('');
    setEmails([]);
    setSelectedEmail(null);
    setProductData(null);
    setDiagnosticLog(null);
    setStatus('Fetching product page...');

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productUrl, emailCount, promotion, customPrompt: customPromptTab1, fetchMethod })
      });

      const data = await response.json();

      // Capture diagnostic log regardless of success/failure
      if (data.diagnosticLog) {
        setDiagnosticLog(data.diagnosticLog);
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to generate');
      }

      setStatus('Parsing emails...');
      setProductData(data.productData);

      const parsed = parseEmails(data.content);
      if (parsed.length === 0) {
        throw new Error('Could not parse emails from response');
      }

      setEmails(parsed);
      setSelectedEmail(parsed[0]);
      setStatus('');
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const copyHtml = async (html) => {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadHtml = (email) => {
    const blob = new Blob([email.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-${email.id}-${email.description.toLowerCase().replace(/\s+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadDiagnosticLog = () => {
    if (!diagnosticLog) return;
    const blob = new Blob([diagnosticLog], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-gen-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // File upload handler for Tab 2
  const handleTemplateFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      setEmailTemplateFile(null);
      setEmailTemplateContent('');
      setTemplateFileName('');
      return;
    }

    // Validate file extension
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.html') && !fileName.endsWith('.htm')) {
      setTemplateError('Please upload a valid HTML file (.html or .htm)');
      event.target.value = ''; // Clear the input
      return;
    }

    setEmailTemplateFile(file);
    setTemplateFileName(file.name);
    setTemplateError('');
    setGeneratedTemplateEmail(null); // Clear previous results

    // Read file content
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      
      // Client-side HTML validation
      if (!content || typeof content !== 'string') {
        setTemplateError('Failed to read file content');
        return;
      }

      // Check if it contains HTML tags
      const hasHtmlTags = /<[a-z][\s\S]*>/i.test(content);
      const hasStructure = /<!DOCTYPE\s+html/i.test(content) || /<html/i.test(content);

      if (!hasHtmlTags || !hasStructure) {
        setTemplateError('The uploaded file does not appear to be valid HTML. It should contain HTML tags and either a DOCTYPE declaration or html tag structure.');
        setEmailTemplateFile(null);
        setEmailTemplateContent('');
        setTemplateFileName('');
        event.target.value = '';
        return;
      }

      setEmailTemplateContent(content);
    };

    reader.onerror = () => {
      setTemplateError('Error reading file. Please try again.');
      setEmailTemplateFile(null);
      setEmailTemplateContent('');
      setTemplateFileName('');
    };

    reader.readAsText(file);
  };

  // Generate template-based email
  const generateTemplateEmail = async () => {
    // Validation
    if (!templateProductUrl.trim()) {
      setTemplateError('Please enter a product URL');
      return;
    }

    // Validate URL format
    try {
      new URL(templateProductUrl.trim());
    } catch {
      setTemplateError('Please enter a valid URL (must start with http:// or https://)');
      return;
    }

    if (!emailTemplateContent.trim()) {
      setTemplateError('Please upload an HTML email template');
      return;
    }

    setTemplateLoading(true);
    setTemplateError('');
    setGeneratedTemplateEmail(null);
    setTemplateUsage(null); // Clear previous usage data
    const selectedModelLabel = modelOptions.find(m => m.value === selectedModel)?.label || selectedModel;
    
    // Show different status for hybrid approach
    if (selectedModel === 'gpt-4o-extract-mini-generate') {
      setTemplateStatus('Step 1: Extracting product data with GPT-4o...');
    } else if (selectedModel === 'claude-sonnet-extract-mini-generate') {
      setTemplateStatus('Step 1: Extracting product data with Claude Sonnet...');
    } else if (selectedModel === 'claude-haiku-extract-mini-generate') {
      setTemplateStatus('Step 1: Extracting product data with Claude Haiku...');
    } else if (selectedModel === 'manual-extract-mini-refine-generate') {
      setTemplateStatus('Step 1: Manually extracting product data...');
    } else {
      setTemplateStatus(`Generating with ${selectedModelLabel}...`);
    }
    setTemplateCopied(false); // Reset copy state

    try {
      const response = await fetch('/api/generate-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productUrl: templateProductUrl.trim(),
          emailTemplate: emailTemplateContent.trim(),
          customPrompt: customPrompt.trim(),
          model: selectedModel
        })
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to generate email');
      }

      if (!data.content || data.content.length < 100) {
        throw new Error('Generated email appears to be invalid or too short');
      }

      // Store usage/cost information
      if (data.usage) {
        setTemplateUsage(data.usage);
        console.log('📊 Token Usage & Cost:', {
          total_tokens: data.usage.total_tokens,
          input_tokens: data.usage.input_tokens,
          output_tokens: data.usage.output_tokens,
          estimated_cost_usd: `$${data.usage.estimated_cost_usd?.toFixed(6) || 'N/A'}`,
          breakdown: data.usage.breakdown || null
        });
      } else {
        setTemplateUsage(null);
      }

      setGeneratedTemplateEmail(data.content);
      setTemplateStatus('');
    } catch (err) {
      setTemplateError(err.message);
      setTemplateStatus('');
    } finally {
      setTemplateLoading(false);
    }
  };

  // Copy HTML for template email
  const copyTemplateHtml = async (html) => {
    await navigator.clipboard.writeText(html);
    setTemplateCopied(true);
    setTimeout(() => setTemplateCopied(false), 2000);
  };

  // Download HTML for template email
  const downloadTemplateHtml = (html) => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-email-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // File upload handler for Tab 3 - Business Info
  const handleBusinessInfoUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      setBusinessInfoContent('');
      setBusinessInfoFileName('');
      return;
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.md')) {
      setTextEmailError('Please upload a valid Markdown file (.md)');
      event.target.value = '';
      return;
    }

    setBusinessInfoFileName(file.name);
    setTextEmailError('');
    setGeneratedTextEmail(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        setTextEmailError('Failed to read file content or file is empty');
        setBusinessInfoContent('');
        setBusinessInfoFileName('');
        event.target.value = '';
        return;
      }
      setBusinessInfoContent(content);
    };
    reader.onerror = () => {
      setTextEmailError('Error reading file. Please try again.');
      setBusinessInfoContent('');
      setBusinessInfoFileName('');
    };
    reader.readAsText(file);
  };

  // File upload handler for Tab 3 - Email Guidelines
  const handleGuidelinesUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      setGuidelinesContent('');
      setGuidelinesFileName('');
      return;
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.md')) {
      setTextEmailError('Please upload a valid Markdown file (.md)');
      event.target.value = '';
      return;
    }

    setGuidelinesFileName(file.name);
    setTextEmailError('');
    setGeneratedTextEmail(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        setTextEmailError('Failed to read file content or file is empty');
        setGuidelinesContent('');
        setGuidelinesFileName('');
        event.target.value = '';
        return;
      }
      setGuidelinesContent(content);
    };
    reader.onerror = () => {
      setTextEmailError('Error reading file. Please try again.');
      setGuidelinesContent('');
      setGuidelinesFileName('');
    };
    reader.readAsText(file);
  };

  // Generate text email for Tab 3
  const generateTextEmail = async () => {
    // Validation
    if (!businessInfoContent.trim()) {
      setTextEmailError('Please upload a Business Info markdown file');
      return;
    }

    if (!guidelinesContent.trim()) {
      setTextEmailError('Please upload an Email Guidelines markdown file');
      return;
    }

    if (!textEmailUserPrompt.trim()) {
      setTextEmailError('Please enter a user prompt describing the email you want to generate');
      return;
    }

    setTextEmailLoading(true);
    setTextEmailError('');
    setGeneratedTextEmail(null);
    setTextEmailUsage(null);
    setTextEmailStatus(`Generating with ${textEmailModelOptions.find(m => m.value === textEmailModel)?.label || textEmailModel}...`);
    setTextEmailCopied(false);

    try {
      const response = await fetch('/api/generate-text-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessInfo: businessInfoContent.trim(),
          emailGuidelines: guidelinesContent.trim(),
          systemPrompt: textEmailSystemPrompt.trim(),
          userPrompt: textEmailUserPrompt.trim(),
          model: textEmailModel
        })
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to generate email');
      }

      if (!data.content || data.content.length < 10) {
        throw new Error('Generated email appears to be invalid or too short');
      }

      if (data.usage) {
        setTextEmailUsage(data.usage);
        console.log('Text Email Usage:', {
          total_tokens: data.usage.total_tokens,
          input_tokens: data.usage.input_tokens,
          output_tokens: data.usage.output_tokens,
          estimated_cost_usd: `$${data.usage.estimated_cost_usd?.toFixed(6) || 'N/A'}`,
          generation_time_ms: data.usage.generation_time_ms
        });
      }

      setGeneratedTextEmail(data.content);
      setTextEmailStatus('');
    } catch (err) {
      setTextEmailError(err.message);
      setTextEmailStatus('');
    } finally {
      setTextEmailLoading(false);
    }
  };

  // Copy text email
  const copyTextEmail = async (text) => {
    await navigator.clipboard.writeText(text);
    setTextEmailCopied(true);
    setTimeout(() => setTextEmailCopied(false), 2000);
  };

  // Download text email
  const downloadTextEmail = (text) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `text-email-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white py-5 px-4 shadow-xl">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
            <span className="text-3xl">✉️</span> 
            Email Template Generator
          </h1>
          
          {/* Tab Navigation */}
          <div className="mt-4 flex gap-1 border-b border-slate-700">
            <button
              onClick={() => setActiveTab('generator')}
              className={`px-4 py-2 text-sm font-medium transition-all relative ${
                activeTab === 'generator'
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Email Generator
              {activeTab === 'generator' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"></span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('new-feature')}
              className={`px-4 py-2 text-sm font-medium transition-all relative ${
                activeTab === 'new-feature'
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Template-Based
              {activeTab === 'new-feature' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"></span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('text-email')}
              className={`px-4 py-2 text-sm font-medium transition-all relative ${
                activeTab === 'text-email'
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Text Email Generator
              {activeTab === 'text-email' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"></span>
              )}
            </button>
          </div>
          
          <p className="text-slate-400 text-sm mt-3">Real page fetching • Gmail-safe HTML • Multiple styles</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-6">
        {/* Tab 1: Email Generator */}
        {activeTab === 'generator' && (
          <>
            {/* Input Card */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Product URL
              </label>
              <input
                type="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://www.store.com/products/example"
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Fetch Method
              </label>
              <select
                value={fetchMethod}
                onChange={(e) => setFetchMethod(e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 text-sm bg-white transition-all cursor-pointer"
              >
                <option value="standard">Standard (100KB)</option>
                <option value="smart">Smart Fetch</option>
              </select>
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Emails
              </label>
              <select
                value={emailCount}
                onChange={(e) => setEmailCount(e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 text-sm bg-white transition-all cursor-pointer"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Promotion (optional)
              </label>
              <input
                type="text"
                value={promotion}
                onChange={(e) => setPromotion(e.target.value)}
                placeholder="e.g., 20% off, flash sale 12 hours"
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 text-sm transition-all"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Custom Prompt (Optional)
            </label>
            <textarea
              value={customPromptTab1}
              onChange={(e) => {
                setCustomPromptTab1(e.target.value);
                if (error) setError('');
              }}
              placeholder="e.g., Use Gmail-safe fonts (Arial, Helvetica), make the tone more casual, emphasize urgency, include a countdown timer, focus on the discount..."
              rows={3}
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all resize-none"
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              onClick={generateEmails}
              disabled={loading}
              className="px-8 py-3 bg-gradient-to-r from-slate-800 to-slate-900 text-white text-sm font-bold uppercase tracking-wide rounded-xl hover:from-slate-700 hover:to-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </span>
              ) : (
                '🚀 Generate Emails'
              )}
            </button>
            
            {status && (
              <span className="text-sm text-slate-500 flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                {status}
              </span>
            )}
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border-2 border-red-200 rounded-xl text-red-700 text-sm">
              <strong>Error:</strong> {error}
              {diagnosticLog && (
                <button
                  onClick={downloadDiagnosticLog}
                  className="ml-3 px-3 py-1 text-xs font-semibold border border-amber-300 text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-all"
                >
                  Download Log
                </button>
              )}
            </div>
          )}

          {productData && (
            <div className="mt-4 p-4 bg-green-50 border-2 border-green-200 rounded-xl text-sm">
              <div className="font-semibold text-green-800 mb-1">✓ Product data extracted:</div>
              <div className="text-green-700">
                {productData.title} • {productData.price} • {productData.imageCount} images found
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        {emails.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Sidebar */}
            <div className="lg:col-span-3">
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-4 sticky top-4">
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span>✨</span> Generated Emails
                </h2>
                <div className="space-y-2">
                  {emails.map((email) => (
                    <button
                      key={email.id}
                      onClick={() => setSelectedEmail(email)}
                      className={`w-full text-left p-4 rounded-xl transition-all ${
                        selectedEmail?.id === email.id
                          ? 'bg-gradient-to-r from-slate-800 to-slate-900 text-white shadow-lg'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-2 border-slate-100'
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                        Option {email.id}
                      </div>
                      <div className="text-sm font-medium mt-1">
                        {email.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="lg:col-span-9">
              {selectedEmail && (
                <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-slate-100 bg-slate-50">
                    <div>
                      <h2 className="font-bold text-slate-800 text-lg">{selectedEmail.description}</h2>
                      <p className="text-xs text-slate-500">Option {selectedEmail.id} • Gmail-ready HTML</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyHtml(selectedEmail.html)}
                        className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                          copied 
                            ? 'bg-green-500 text-white' 
                            : 'border-2 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {copied ? '✓ Copied!' : '📋 Copy'}
                      </button>
                      <button
                        onClick={() => downloadHtml(selectedEmail)}
                        className="px-5 py-2.5 text-sm font-semibold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all"
                      >
                        ⬇ Download
                      </button>
                      {diagnosticLog && (
                        <button
                          onClick={downloadDiagnosticLog}
                          className="px-5 py-2.5 text-sm font-semibold border-2 border-amber-300 text-amber-700 bg-amber-50 rounded-xl hover:bg-amber-100 transition-all"
                        >
                          📋 Download Log
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="p-6 bg-gradient-to-b from-slate-100 to-slate-50">
                    <div className="max-w-[620px] mx-auto bg-white shadow-2xl rounded-lg overflow-hidden">
                      <iframe
                        srcDoc={selectedEmail.html}
                        title="Email Preview"
                        className="w-full border-0"
                        style={{ height: '700px' }}
                      />
                    </div>
                  </div>

                  <details className="border-t-2 border-slate-100">
                    <summary className="p-4 cursor-pointer text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50">
                      &lt;/&gt; View HTML Source
                    </summary>
                    <div className="p-4 bg-slate-900 overflow-auto max-h-80">
                      <pre className="text-xs text-emerald-400 whitespace-pre-wrap font-mono">
                        {selectedEmail.html}
                      </pre>
                    </div>
                  </details>
                </div>
              )}
            </div>
          </div>
        )}

            {/* Empty State */}
            {!loading && emails.length === 0 && !error && (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-12 text-center">
                <div className="text-6xl mb-4">📧</div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Ready to generate</h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
                  Paste any ecommerce product URL. The app will fetch the real page data including images, then generate Gmail-ready HTML emails.
                </p>
                <div className="inline-block px-4 py-2 bg-slate-100 rounded-lg text-xs text-slate-600 font-mono">
                  Works with Shopify, WooCommerce, BigCommerce, and more
                </div>
              </div>
            )}
          </>
        )}

        {/* Tab 2: Template-based Email Generator */}
        {activeTab === 'new-feature' && (
          <>
            {/* Input Card */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-4">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    AI Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 text-sm bg-white transition-all cursor-pointer"
                  >
                    {modelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-8">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Product URL
                  </label>
                  <input
                    type="url"
                    value={templateProductUrl}
                    onChange={(e) => {
                      setTemplateProductUrl(e.target.value);
                      if (templateError && e.target.value.trim()) {
                        setTemplateError(''); // Clear error when user starts typing
                      }
                    }}
                    placeholder="https://www.store.com/products/example"
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all"
                  />
                </div>
              </div>
              
              <div className="mt-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Email Template (HTML File)
                </label>
                  <div className="relative">
                    <input
                      type="file"
                      accept=".html,.htm"
                      onChange={handleTemplateFileUpload}
                      className="hidden"
                      id="template-file-input"
                    />
                    <label
                      htmlFor="template-file-input"
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all cursor-pointer bg-white hover:bg-slate-50 flex items-center justify-between"
                    >
                      <span className="text-slate-600">
                        {templateFileName || 'Choose HTML file...'}
                      </span>
                      <span className="text-slate-400">📎</span>
                    </label>
                  </div>
                  {templateFileName && (
                    <p className="text-xs text-slate-500 mt-1">✓ {templateFileName}</p>
                  )}
              </div>

              <div className="mt-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Custom Prompt (Optional)
                </label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => {
                    setCustomPrompt(e.target.value);
                    if (templateError) {
                      setTemplateError(''); // Clear error when user starts typing
                    }
                  }}
                  placeholder="e.g., Use a more casual tone, emphasize the discount, add urgency..."
                  rows={3}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all resize-none"
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <button
                  onClick={generateTemplateEmail}
                  disabled={templateLoading}
                  className="px-8 py-3 bg-gradient-to-r from-slate-800 to-slate-900 text-white text-sm font-bold uppercase tracking-wide rounded-xl hover:from-slate-700 hover:to-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                >
                  {templateLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generating...
                    </span>
                  ) : (
                    '🚀 Generate Email'
                  )}
                </button>
                
                {templateStatus && (
                  <span className="text-sm text-slate-500 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    {templateStatus}
                  </span>
                )}
              </div>

              {templateError && (
                <div className="mt-4 p-4 bg-red-50 border-2 border-red-200 rounded-xl text-red-700 text-sm">
                  <strong>Error:</strong> {templateError}
                </div>
              )}
            </div>

            {/* Results */}
            {generatedTemplateEmail && (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
                {/* Token Usage & Cost Display */}
                {templateUsage && (
                  <div className="px-4 pt-4 pb-2 border-b border-slate-100">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 font-medium">Total Tokens:</span>
                        <span className="text-slate-800 font-bold">{templateUsage.total_tokens?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 font-medium">Cost:</span>
                        <span className="text-green-600 font-bold">
                          ${templateUsage.estimated_cost_usd?.toFixed(6) || '0.000000'}
                        </span>
                      </div>
                      {templateUsage.breakdown && (
                        <>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>Extraction:</span>
                            <span className="font-semibold">${templateUsage.breakdown.extraction?.estimated_cost_usd?.toFixed(6) || '0.000000'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>Generation:</span>
                            <span className="font-semibold">${templateUsage.breakdown.generation?.estimated_cost_usd?.toFixed(6) || '0.000000'}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-slate-100 bg-slate-50">
                  <div>
                    <h2 className="font-bold text-slate-800 text-lg">Generated Email</h2>
                    <p className="text-xs text-slate-500">Template-based • Gmail-ready HTML</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyTemplateHtml(generatedTemplateEmail)}
                      className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                        templateCopied 
                          ? 'bg-green-500 text-white' 
                          : 'border-2 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {templateCopied ? '✓ Copied!' : '📋 Copy'}
                    </button>
                    <button
                      onClick={() => downloadTemplateHtml(generatedTemplateEmail)}
                      className="px-5 py-2.5 text-sm font-semibold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all"
                    >
                      ⬇ Download
                    </button>
                  </div>
                </div>
                
                <div className="p-6 bg-gradient-to-b from-slate-100 to-slate-50">
                  <div className="max-w-[620px] mx-auto bg-white shadow-2xl rounded-lg overflow-hidden">
                    <iframe
                      srcDoc={generatedTemplateEmail}
                      title="Email Preview"
                      className="w-full border-0"
                      style={{ height: '700px' }}
                    />
                  </div>
                </div>

                <details className="border-t-2 border-slate-100">
                  <summary className="p-4 cursor-pointer text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50">
                    &lt;/&gt; View HTML Source
                  </summary>
                  <div className="p-4 bg-slate-900 overflow-auto max-h-80">
                    <pre className="text-xs text-emerald-400 whitespace-pre-wrap font-mono">
                      {generatedTemplateEmail}
                    </pre>
                  </div>
                </details>
              </div>
            )}

            {/* Empty State */}
            {!templateLoading && !generatedTemplateEmail && !templateError && (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-12 text-center">
                <div className="text-6xl mb-4">📧</div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Ready to generate</h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
                  Upload an HTML email template and provide a product URL. The app will use the template structure to create a new promotional email for the specified product.
                </p>
                <div className="inline-block px-4 py-2 bg-slate-100 rounded-lg text-xs text-slate-600 font-mono">
                  Template-based generation • Custom prompts • Gmail-ready HTML
                </div>
              </div>
            )}
          </>
        )}

        {/* Tab 3: Text Email Generator */}
        {activeTab === 'text-email' && (
          <>
            {/* Input Card */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
              {/* Model Selector */}
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  AI Model
                </label>
                <select
                  value={textEmailModel}
                  onChange={(e) => setTextEmailModel(e.target.value)}
                  className="w-full md:w-64 px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 text-sm bg-white transition-all cursor-pointer"
                >
                  {textEmailModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* File Uploads - 2 columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Business Info Upload */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Business Info (RAG Data) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="file"
                      accept=".md"
                      onChange={handleBusinessInfoUpload}
                      className="hidden"
                      id="business-info-input"
                    />
                    <label
                      htmlFor="business-info-input"
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all cursor-pointer bg-white hover:bg-slate-50 flex items-center justify-between"
                    >
                      <span className="text-slate-600">
                        {businessInfoFileName || 'Choose .md file...'}
                      </span>
                      <span className="text-slate-400">📎</span>
                    </label>
                  </div>
                  {businessInfoFileName && (
                    <p className="text-xs text-green-600 mt-1">✓ {businessInfoFileName}</p>
                  )}
                </div>

                {/* Email Guidelines Upload */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Email Guidelines & Templates <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="file"
                      accept=".md"
                      onChange={handleGuidelinesUpload}
                      className="hidden"
                      id="guidelines-input"
                    />
                    <label
                      htmlFor="guidelines-input"
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all cursor-pointer bg-white hover:bg-slate-50 flex items-center justify-between"
                    >
                      <span className="text-slate-600">
                        {guidelinesFileName || 'Choose .md file...'}
                      </span>
                      <span className="text-slate-400">📎</span>
                    </label>
                  </div>
                  {guidelinesFileName && (
                    <p className="text-xs text-green-600 mt-1">✓ {guidelinesFileName}</p>
                  )}
                </div>
              </div>

              {/* System Prompt */}
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  System Prompt <span className="text-slate-400 font-normal normal-case">(applies to all emails)</span>
                </label>
                <textarea
                  value={textEmailSystemPrompt}
                  onChange={(e) => {
                    setTextEmailSystemPrompt(e.target.value);
                    if (textEmailError) setTextEmailError('');
                  }}
                  placeholder="Enter your system prompt here... (e.g., 'You are a professional sales representative for HYROS. Your writing style is concise, personalized, and value-focused.')"
                  rows={4}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all resize-none"
                />
              </div>

              {/* User Prompt */}
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  User Prompt <span className="text-red-500">*</span> <span className="text-slate-400 font-normal normal-case">(specific to this email)</span>
                </label>
                <textarea
                  value={textEmailUserPrompt}
                  onChange={(e) => {
                    setTextEmailUserPrompt(e.target.value);
                    if (textEmailError) setTextEmailError('');
                  }}
                  placeholder="Enter what email you want to generate... (e.g., 'Write an introduction email to Sarah Johnson, CEO of TechCorp. Reference their recent Series B funding and ask about their marketing attribution challenges.')"
                  rows={4}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-sm transition-all resize-none"
                />
              </div>

              {/* Generate Button */}
              <div className="flex flex-wrap items-center gap-4">
                <button
                  onClick={generateTextEmail}
                  disabled={textEmailLoading}
                  className="px-8 py-3 bg-gradient-to-r from-slate-800 to-slate-900 text-white text-sm font-bold uppercase tracking-wide rounded-xl hover:from-slate-700 hover:to-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                >
                  {textEmailLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generating...
                    </span>
                  ) : (
                    '🚀 Generate Email'
                  )}
                </button>

                {textEmailStatus && (
                  <span className="text-sm text-slate-500 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    {textEmailStatus}
                  </span>
                )}
              </div>

              {textEmailError && (
                <div className="mt-4 p-4 bg-red-50 border-2 border-red-200 rounded-xl text-red-700 text-sm">
                  <strong>Error:</strong> {textEmailError}
                </div>
              )}
            </div>

            {/* Results - Gmail Simulation */}
            {generatedTextEmail && (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
                {/* Usage Stats */}
                {textEmailUsage && (
                  <div className="px-4 pt-4 pb-2 border-b border-slate-100">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 font-medium">Tokens:</span>
                        <span className="text-slate-800 font-bold">{textEmailUsage.total_tokens?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 font-medium">Cost:</span>
                        <span className="text-green-600 font-bold">
                          ${textEmailUsage.estimated_cost_usd?.toFixed(6) || '0.000000'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 font-medium">Time:</span>
                        <span className="text-slate-800 font-bold">
                          {textEmailUsage.generation_time_ms ? `${(textEmailUsage.generation_time_ms / 1000).toFixed(2)}s` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-slate-100 bg-slate-50">
                  <div>
                    <h2 className="font-bold text-slate-800 text-lg">📧 Email Preview</h2>
                    <p className="text-xs text-slate-500">Plain text • Copy/paste ready</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyTextEmail(generatedTextEmail)}
                      className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                        textEmailCopied
                          ? 'bg-green-500 text-white'
                          : 'border-2 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {textEmailCopied ? '✓ Copied!' : '📋 Copy'}
                    </button>
                    <button
                      onClick={() => downloadTextEmail(generatedTextEmail)}
                      className="px-5 py-2.5 text-sm font-semibold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all"
                    >
                      ⬇ Download
                    </button>
                  </div>
                </div>

                {/* Gmail-style Email Preview */}
                <div className="p-6 bg-gradient-to-b from-slate-100 to-slate-50">
                  <div className="max-w-[620px] mx-auto bg-white shadow-2xl rounded-lg overflow-hidden border border-slate-200">
                    {/* Gmail-like header */}
                    <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
                      <div className="flex items-center gap-2 text-slate-500 text-xs">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                          <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                        </svg>
                        <span>Email Preview</span>
                      </div>
                    </div>

                    {/* Email Content */}
                    <div className="px-6 py-6">
                      <pre className="font-sans text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                        {generatedTextEmail}
                      </pre>
                    </div>
                  </div>
                </div>

                {/* Raw Text View */}
                <details className="border-t-2 border-slate-100">
                  <summary className="p-4 cursor-pointer text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50">
                    📝 View Raw Text
                  </summary>
                  <div className="p-4 bg-slate-900 overflow-auto max-h-80">
                    <pre className="text-xs text-emerald-400 whitespace-pre-wrap font-mono">
                      {generatedTextEmail}
                    </pre>
                  </div>
                </details>
              </div>
            )}

            {/* Empty State */}
            {!textEmailLoading && !generatedTextEmail && !textEmailError && (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-12 text-center">
                <div className="text-6xl mb-4">✉️</div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Ready to generate text emails</h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
                  Upload your business research and email guidelines as markdown files, then enter your prompts to generate personalized text emails.
                </p>
                <div className="inline-block px-4 py-2 bg-slate-100 rounded-lg text-xs text-slate-600 font-mono">
                  GPT-5.2 powered • RAG-enhanced • Plain text output
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
