// ClipShield Content Script - Hybrid: Text Auto-Redact + Image Warnings
// Text: Auto-redact with placeholders (proven working code)
// Images: Show warning modal, user decides
/* global LanguageModel */

console.log('🚀 ClipShield content script loaded');

// Default site configurations
const DEFAULT_SITE_CONFIGS = {
  'chatgpt.com': { name: 'ChatGPT', selector: 'textarea[data-id], #prompt-textarea, textarea[placeholder*="Message"]' },
  'claude.ai': { name: 'Claude', selector: 'div[contenteditable="true"], .ProseMirror' },
  'gemini.google.com': { name: 'Gemini', selector: 'rich-textarea, div[contenteditable="true"], textarea' },
  'perplexity.ai': { name: 'Perplexity', selector: 'textarea[placeholder*="Ask"], textarea' },
  'docs.google.com': { name: 'Google Docs', selector: '.docs-texteventtarget-iframe' }
};

// Dynamic site configurations (will be populated with custom sites)
let SITE_CONFIGS = { ...DEFAULT_SITE_CONFIGS };

// Extract clean hostname from various URL formats
function extractHostname(url) {
  try {
    // Remove protocol if present
    let cleaned = url.replace(/^https?:\/\//, '');
    // Remove www. prefix
    cleaned = cleaned.replace(/^www\./, '');
    // Remove path and query params
    cleaned = cleaned.split('/')[0].split('?')[0];
    return cleaned;
  } catch (error) {
    return url;
  }
}

// Regex patterns for PII detection (UK/US enterprise & individual)
const PII_PATTERNS = {
  // Contact & Identity
  email: { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, type: 'email' },
  uk_phone: { pattern: /\b0[127]\d{3}\s?\d{3}\s?\d{3,4}\b/g, type: 'phone' }, // UK landline/mobile (01xxx, 02x, 07xxx)
  phone: { pattern: /(\+\d{1,3}[\s-]?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/g, type: 'phone' }, // US/International
  
  // Government IDs
  ssn: { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, type: 'ssn' },
  ni_number: { pattern: /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi, type: 'ni_number' }, // UK National Insurance
  passport: { pattern: /\b[A-Z]{1,2}\d{6,9}\b/g, type: 'passport' }, // UK/US passport numbers
  
  // Financial
  credit_card: { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, type: 'credit_card' },
  account_number: { pattern: /\b(?:account|acct)[\s#:]*\d{8,17}\b/gi, type: 'account_number' },
  sort_code: { pattern: /\b\d{2}-\d{2}-\d{2}\b/g, type: 'sort_code' }, // UK bank sort code
  
  // Healthcare
  nhs_number: { pattern: /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g, type: 'nhs_number' }, // UK NHS number
  medical_id: { pattern: /\b(?:patient|medical|mrn)[\s#:]*[A-Z0-9]{6,12}\b/gi, type: 'medical_id' },
  
  // Enterprise
  contract_id: { pattern: /\b(?:contract|agreement|project)[\s#:]*#?[A-Z0-9-]{6,}\b/gi, type: 'contract_id' },
  invoice: { pattern: /\b(?:invoice|inv|po)[\s#:]*#?[A-Z0-9-]{4,}\b/gi, type: 'invoice' },
  employee_id: { pattern: /\b(?:employee|emp|staff)[\s#:]*#?[A-Z0-9]{4,10}\b/gi, type: 'employee_id' },
  
  // Location
  address: { pattern: /\b\d+\s+[\w\s]+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Way)\b/gi, type: 'address' },
  uk_postcode: { pattern: /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/gi, type: 'uk_postcode' },
  us_zip: { pattern: /\b\d{5}(?:-\d{4})?\b/g, type: 'us_zip' },
  
  // Dates & Other
  dob: { pattern: /\b(?:dob|date of birth)[\s:]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, type: 'dob' },
  ip_address: { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, type: 'ip_address' }
};

// Placeholder Manager (inline)
const placeholderManager = {
  mappings: new Map(),
  
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36).padStart(4, '0');
  },
  
  generatePlaceholder(type, value) {
    let normalizedValue = value.toLowerCase();
    if (type === 'phone') {
      normalizedValue = value.replace(/\D/g, '');
    }
    const hash = this.simpleHash(normalizedValue).substring(0, 4);
    return `[${type.toUpperCase()}_${hash}]`;
  },
  
  sanitizeText(text, piiItems) {
    if (!piiItems || piiItems.length === 0) return { sanitizedText: text, replacements: [] };
    
    // Remove overlapping items - keep longer/more specific ones
    const filtered = this.filterOverlaps(piiItems);
    console.log(`📊 Filtered ${piiItems.length} items to ${filtered.length} (removed ${piiItems.length - filtered.length} overlaps)`);
    
    // Sort by position (reverse order for replacement from end to start)
    const sorted = [...filtered].sort((a, b) => b.start - a.start);
    let sanitized = text;
    const replacements = [];
    
    for (const item of sorted) {
      const placeholder = this.generatePlaceholder(item.type, item.value);
      this.mappings.set(placeholder, item.value);
      
      // Verify the text at this position matches what we expect
      const actualText = text.substring(item.start, item.end);
      if (actualText.toLowerCase() !== item.value.toLowerCase()) {
        console.warn(`⚠️ Mismatch at position ${item.start}: expected "${item.value}", found "${actualText}"`);
        continue; // Skip this item to avoid corruption
      }
      
      sanitized = sanitized.substring(0, item.start) + placeholder + sanitized.substring(item.end);
      replacements.push({ original: item.value, placeholder, type: item.type });
    }
    
    return { sanitizedText: sanitized, replacements };
  },
  
  filterOverlaps(items) {
    if (items.length === 0) return [];
    
    // Sort by start position, then by length (longer first for same start)
    const sorted = [...items].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return (b.end - b.start) - (a.end - a.start); // Longer items first
    });
    
    const filtered = [];
    
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      let shouldAdd = true;
      
      // Check against all previously added items
      for (const existing of filtered) {
        // Check if current overlaps with existing
        const overlaps = (current.start < existing.end && current.end > existing.start);
        
        if (overlaps) {
          // If they overlap, keep the longer/more specific one
          const currentLength = current.end - current.start;
          const existingLength = existing.end - existing.start;
          
          if (currentLength <= existingLength) {
            // Current is shorter or equal, skip it
            console.log(`  - Skipping overlapping item: "${current.value}" at ${current.start}-${current.end} (overlaps with "${existing.value}")`);
            shouldAdd = false;
            break;
          } else {
            // Current is longer, we should remove the existing one
            // But since we sort by length (longer first), this shouldn't happen
            // unless items have same start position
            console.log(`  - Replacing shorter item: "${existing.value}" with longer "${current.value}"`);
            const index = filtered.indexOf(existing);
            filtered.splice(index, 1);
            break;
          }
        }
      }
      
      if (shouldAdd) {
        filtered.push(current);
      }
    }
    
    // Sort by position again for proper replacement order
    return filtered.sort((a, b) => a.start - b.start);
  },
  
  hasPlaceholders(text) {
    return /\[(PII|NAME|PERSON|EMAIL|PHONE|ADDRESS|SSN|NI_NUMBER|PASSPORT|CREDIT_CARD|ACCOUNT_NUMBER|SORT_CODE|NHS_NUMBER|MEDICAL_ID|CONTRACT_ID|INVOICE|EMPLOYEE_ID|UK_POSTCODE|US_ZIP|DOB|IP_ADDRESS|COMPANY|MISCELLANEOUS|CUSTOM_PATTERN_[A-Z0-9_]+)_[a-z0-9]+\]/i.test(text);
  },
  
  restoreText(text) {
    if (!this.hasPlaceholders(text)) return { restoredText: text, restoredCount: 0 };
    
    let restored = text;
    let count = 0;
    const matches = text.match(/\[(PII|NAME|PERSON|EMAIL|PHONE|ADDRESS|SSN|NI_NUMBER|PASSPORT|CREDIT_CARD|ACCOUNT_NUMBER|SORT_CODE|NHS_NUMBER|MEDICAL_ID|CONTRACT_ID|INVOICE|EMPLOYEE_ID|UK_POSTCODE|US_ZIP|DOB|IP_ADDRESS|COMPANY|MISCELLANEOUS|CUSTOM_PATTERN_[A-Z0-9_]+)_[a-z0-9]+\]/gi) || [];
    
    for (const placeholder of matches) {
      const original = this.mappings.get(placeholder);
      if (original) {
        restored = restored.replace(placeholder, original);
        count++;
      }
    }
    
    return { restoredText: restored, restoredCount: count };
  }
};

// Image Warning Modal (inline to avoid loading issues)
function showWarningModal(detectedTypes) {
  return new Promise((resolve) => {
    const typeLabels = {
      credit_card: 'Credit Card',
      driver_license: 'Driver\'s License',
      passport: 'Passport',
      medical_card: 'Medical Card',
      id_card: 'ID Card'
    };
    
    const typeList = detectedTypes
      .map(type => typeLabels[type] || type)
      .map(label => `<strong>${label}</strong>`)
      .join(', ');
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center;
      z-index: 999999; font-family: system-ui, -apple-system, sans-serif;
      backdrop-filter: blur(4px);
    `;
    
    modal.innerHTML = `
      <div style="background: white; border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);">
        <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px;">
          <div style="flex-shrink: 0; font-size: 32px;">⚠️</div>
          <div>
            <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #1F2937;">
              Sensitive Content Detected
            </h2>
            <p style="margin: 0; font-size: 14px; color: #6B7280;">
              This image contains personal information
            </p>
          </div>
        </div>
        
        <div style="background: #FEF3C7; border-left: 3px solid #F59E0B; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 14px; color: #92400E; line-height: 1.5;">
            <strong>Detected:</strong> ${typeList}
          </p>
        </div>
        
        <p style="font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 16px;">
          Sharing this with AI services sends your data to third-party companies with limited control over its use.
        </p>
        
        <div id="learn-more-section" style="display: none; background: #F9FAFB; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="font-size: 13px; color: #4B5563; line-height: 1.6; margin: 0 0 12px 0;">
            <strong>Your data may be:</strong>
          </p>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #6B7280; line-height: 1.8;">
            <li>Retained indefinitely by AI providers</li>
            <li>Used to train future AI models</li>
            <li>Shared with partners or contractors</li>
            <li>Subject to data breaches</li>
          </ul>
        </div>
        
        <button id="learn-more-btn" style="background: none; border: none; color: #6366F1; font-size: 13px; font-weight: 500; cursor: pointer; padding: 0; margin-bottom: 20px; text-decoration: underline;">
          📖 Learn More
        </button>
        
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button id="cancel-btn" style="padding: 10px 20px; border: 1px solid #D1D5DB; border-radius: 8px; background: white; color: #374151; font-size: 14px; font-weight: 500; cursor: pointer;">
            Cancel
          </button>
          <button id="share-anyway-btn" style="padding: 10px 20px; border: none; border-radius: 8px; background: #EF4444; color: white; font-size: 14px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px;">
            <span>Share Anyway</span><span style="font-size: 16px;">⚠️</span>
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const learnMoreBtn = modal.querySelector('#learn-more-btn');
    const learnMoreSection = modal.querySelector('#learn-more-section');
    const cancelBtn = modal.querySelector('#cancel-btn');
    const shareBtn = modal.querySelector('#share-anyway-btn');
    
    learnMoreBtn.addEventListener('click', () => {
      const isVisible = learnMoreSection.style.display === 'block';
      learnMoreSection.style.display = isVisible ? 'none' : 'block';
      learnMoreBtn.textContent = isVisible ? '📖 Learn More' : '📖 Show Less';
    });
    
    const cleanup = () => {
      modal.style.opacity = '0';
      setTimeout(() => modal.remove(), 200);
    };
    
    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(false);
    });
    
    shareBtn.addEventListener('click', () => {
      cleanup();
      resolve(true);
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cleanup();
        resolve(false);
      }
    });
    
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s';
    setTimeout(() => modal.style.opacity = '1', 10);
  });
}

// Global state
let aiAvailable = false;
let isProtectionEnabled = true; // Will be loaded from storage on init
let isProcessingPaste = false; // Prevent infinite loops when re-pasting
let isProcessingFileUpload = false; // Prevent infinite loops when re-triggering file uploads
let isProcessingDrop = false; // Prevent infinite loops when re-triggering drops
let pendingAnalysis = null; // Track ongoing clipboard analysis
let indicatorMinimizeTimer = null; // Timer for auto-minimizing indicator
let isIndicatorMinimized = false; // Track minimized state
let enabledPiiTypes = {}; // User's PII type preferences
let warmAISession = null; // Pre-warmed AI session for faster analysis
let isWarmingSession = false; // Track if we're currently warming a session
let bypassNextPaste = false; // Power user bypass flag

// Session stats
let sessionStats = {
  totalProtected: 0,
  totalPastes: 0
};

// Load stats on init
async function loadSessionStats() {
  try {
    const result = await chrome.storage.local.get(['stats']);
    if (result.stats) {
      sessionStats = result.stats;
    }
  } catch (error) {
    console.log('Could not load stats:', error);
  }
}

// Update stats
async function updateStats(piiCount) {
  sessionStats.totalPastes++;
  sessionStats.totalProtected += piiCount;
  
  try {
    await chrome.storage.local.set({ stats: sessionStats });
  } catch (error) {
    console.log('Could not save stats:', error);
  }
}

// Set analyzing state for live badge
async function setAnalyzing(isAnalyzing) {
  try {
    await chrome.storage.local.set({ isAnalyzing });
  } catch (error) {
    console.log('Could not set analyzing state:', error);
  }
}

// Clipboard cache for instant paste
const clipboardCache = {
  entries: new Map(), // hash -> {sanitized, piiItems, timestamp}
  maxEntries: 5,
  maxAge: 5 * 60 * 1000, // 5 minutes
  
  hash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(36);
  },
  
  set(text, sanitized, piiItems) {
    const key = this.hash(text);
    this.entries.set(key, {
      sanitized,
      piiItems,
      timestamp: Date.now()
    });
    
    // Cleanup old entries
    this.cleanup();
  },
  
  get(text) {
    const key = this.hash(text);
    const entry = this.entries.get(key);
    
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.entries.delete(key);
      return null;
    }
    
    return entry;
  },
  
  cleanup() {
    // Remove oldest entries if over limit
    if (this.entries.size > this.maxEntries) {
      const sorted = Array.from(this.entries.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = sorted.slice(0, this.entries.size - this.maxEntries);
      toRemove.forEach(([key]) => this.entries.delete(key));
    }
    
    // Remove expired entries
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.timestamp > this.maxAge) {
        this.entries.delete(key);
      }
    }
  }
};

function getSiteConfig() {
  const hostname = window.location.hostname;
  for (const [domain, config] of Object.entries(SITE_CONFIGS)) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return config;
    }
  }
  return null;
}

// TEXT PII DETECTION (Working backup code)
async function detectWithRegex(text) {
  const allDetections = [];
  
  // FIRST: Detect ALL built-in patterns (even disabled ones)
  for (const [_, { pattern, type }] of Object.entries(PII_PATTERNS)) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      allDetections.push({
        type, 
        value: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }
  
  // SECOND: Add custom patterns
  try {
    const result = await chrome.storage.sync.get(['customPatterns']);
    const customPatterns = result.customPatterns || [];
    
    for (const customPattern of customPatterns) {
      if (!customPattern.enabled) continue;
      
      try {
        const flags = customPattern.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(customPattern.pattern, flags);
        
        let match;
        while ((match = regex.exec(text)) !== null) {
          allDetections.push({
            type: `custom_${customPattern.id}`,
            value: match[0],
            start: match.index,
            end: match.index + match[0].length
          });
        }
      } catch (error) {
        console.error(`Failed to apply custom pattern "${customPattern.name}":`, error);
      }
    }
  } catch (error) {
    console.log('Could not load custom patterns for regex:', error);
  }
  
  // SECOND: Remove overlaps (keep more specific patterns)
  // Sort by start position, then by length (longer/more specific first)
  const sorted = [...allDetections].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });
  
  const deduped = [];
  let lastEnd = -1;
  
  for (const item of sorted) {
    if (item.start < lastEnd) {
      // This overlaps with previous item, skip it
      continue;
    }
    deduped.push(item);
    lastEnd = item.end;
  }
  
  // THIRD: Filter out disabled types
  const filteredItems = deduped.filter(item => {
    if (enabledPiiTypes[item.type] === false) {
      console.log(`⏭️ Regex found ${item.type} but it's disabled in settings, skipping "${item.value}"`);
      return false;
    }
    return true;
  });
  
  return filteredItems;
}

// Build dynamic AI prompt based on enabled PII types and custom patterns
async function buildAISystemPrompt() {
  // Map PII types to their AI detection descriptions
  const typeDescriptions = {
    name: 'name (person names in ANY format/language/context: full names, first+last, chat usernames, foreign/uncommon names)',
    company: 'company (ALL organization/business/corporate names: company names with "Inc", "LLC", "Solutions", "Industries", "Technologies", etc., partner organizations, vendor names, client companies)',
    email: 'email',
    phone: 'phone',
    address: 'address (with street numbers)',
    ssn: 'ssn',
    credit_card: 'credit_card'
  };
  
  // Build list of enabled types only
  const enabledTypes = [];
  for (const [type, description] of Object.entries(typeDescriptions)) {
    if (enabledPiiTypes[type] !== false) {
      enabledTypes.push(description);
    }
  }
  
  // Load and add custom patterns
  try {
    const result = await chrome.storage.sync.get(['customPatterns']);
    const customPatterns = result.customPatterns || [];
    
    for (const pattern of customPatterns) {
      if (!pattern.enabled) continue; // Skip disabled patterns
      
      let description;
      if (pattern.mode === 'exact' || pattern.mode === 'simple') {
        // For exact mode, show first few items as examples
        const examples = pattern.items.slice(0, 5).join(', ');
        const more = pattern.items.length > 5 ? ` and ${pattern.items.length - 5} more` : '';
        description = `custom_${pattern.id} (${pattern.description || pattern.name}: exact matches like ${examples}${more})`;
      } else if (pattern.mode === 'smart_examples') {
        // For smart examples, tell AI these are EXAMPLES to learn from
        const examples = pattern.items.slice(0, 5).join(', ');
        const more = pattern.items.length > 5 ? ` and ${pattern.items.length - 5} more examples` : '';
        description = `custom_${pattern.id} (${pattern.description || pattern.name}: LEARN from these examples: ${examples}${more}. Detect anything matching the SAME PATTERN/FORMAT, not just these exact strings)`;
      } else {
        // For regex mode, explain the pattern
        description = `custom_${pattern.id} (${pattern.description || pattern.name}: matching pattern ${pattern.pattern})`;
      }
      
      enabledTypes.push(description);
    }
  } catch (error) {
    console.log('Could not load custom patterns for AI:', error);
  }
  
  // If no types enabled, return minimal prompt
  if (enabledTypes.length === 0) {
    return {
      role: 'system',
      content: `Return empty JSON: {"items":[]}`
    };
  }
  
  const typesString = enabledTypes.join(', ');
  
  return {
    role: 'system',
    content: `PII detection expert. Return ONLY valid JSON: {"items":[{"type":"TYPE_HERE","value":"exact text"}]}

Types: ${typesString}

CRITICAL: Use the EXACT type from the list above. For example:
- Person names → type: "name"
- Organizations/companies (e.g., "TechFlow Industries", "CloudSync Solutions", "Microsoft", "DataVault") → type: "company"
- Custom types → type: "custom_PATTERN_ID"

Rules: 
1. Detect ALL names (people and companies) even in timestamps/headers like "[time] Name:" or "Name said:"
2. For full names (e.g., "Sarah Chen"), detect the COMPLETE name as ONE item, not separate parts
3. Include EXACT text from document - preserve case, spacing, and punctuation
4. Find ALL occurrences - scan entire text thoroughly
5. Company names often include: Solutions, Industries, Technologies, Systems, Inc, LLC, Corp, Ltd`
  };
}

async function detectTextPII(text) {
  console.log('🔍 Detecting text PII...');
  console.log('  - aiAvailable:', aiAvailable);
  console.log('  - typeof LanguageModel:', typeof LanguageModel);
  console.log('  - warmAISession available:', !!warmAISession);
  console.log('  - enabledPiiTypes:', enabledPiiTypes);
  
  let allItems = [];
  
  // Always use regex
  allItems = await detectWithRegex(text);
  console.log(`📊 Regex detected ${allItems.length} PII items:`, allItems.map(i => `${i.type}: "${i.value}"`));
  
  // Try AI if available
  console.log('🤖 Checking if AI should run:', aiAvailable);
  if (aiAvailable) {
    try {
      // Build dynamic prompt based on enabled types and custom patterns
      const systemPrompt = await buildAISystemPrompt();
      
      let session;
      if (warmAISession) {
        console.log('⚡ Using pre-warmed AI session');
        session = warmAISession;
        warmAISession = null; // Clear it so we create a fresh one for next time
      } else {
        console.log('🤖 Creating new AI session...');
        session = await LanguageModel.create({
          initialPrompts: [systemPrompt],
          temperature: 0.1,
          topK: 1,
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }]
        });
      }
      
      const prompt = `Detect all PII in this text:\n\n${text}\n\nJSON:`;
      
      const response = await session.prompt(prompt, {
        outputLanguage: "en"
      });
      await session.destroy();
      
      // Start warming a new session for next time
      warmAISession = null; // Reset
      warmAISessionInBackground().catch(err => {
        console.log('Failed to warm session in background:', err);
      });
      
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.items && Array.isArray(data.items)) {
          // Add AI items that regex missed
          const regexValues = new Set(allItems.map(i => i.value.toLowerCase()));
          let aiAddedCount = 0;
          
          // Known types that we explicitly asked AI to detect
          const knownAITypes = ['name', 'company', 'email', 'phone', 'address', 'ssn', 'credit_card'];
          
          for (const item of data.items) {
            let itemType = item.type;
            
            // Check if it's a custom pattern type (starts with "custom_")
            if (itemType.startsWith('custom_')) {
              // Keep the custom type as-is for proper tracking
              console.log(`🤖 AI detected custom pattern type: ${itemType}`);
            } else if (!knownAITypes.includes(itemType)) {
              // Map unknown types to "miscellaneous" (AI smart detection)
              console.log(`🤖 AI detected unknown type "${itemType}", mapping to miscellaneous`);
              itemType = 'miscellaneous';
            }
            
            // Filter out email domains detected as companies when email is disabled
            if (itemType === 'company' && enabledPiiTypes.email === false) {
              // Check if this looks like an email domain (contains @ or looks like domain.com)
              if (item.value.includes('@') || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(item.value)) {
                console.log(`⏭️ Skipping email domain "${item.value}" detected as company (email disabled)`);
                continue;
              }
            }
            
            // Check if this type is disabled in settings
            if (enabledPiiTypes[itemType] === false) {
              console.log(`⏭️ ${itemType} is disabled in settings, skipping "${item.value}"`);
              continue;
            }
            
            if (item.value && !regexValues.has(item.value.toLowerCase())) {
              // Find all occurrences
              const escaped = item.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(escaped, 'gi');
              let match;
              while ((match = regex.exec(text)) !== null) {
                allItems.push({
                  type: itemType,  // Use mapped type, not original
                  value: match[0],
                  start: match.index,
                  end: match.index + match[0].length
                });
                aiAddedCount++;
              }
            }
          }
          console.log(`🤖 AI added ${aiAddedCount} additional PII items`);
        }
      }
    } catch (error) {
      console.log('⚠️ AI detection failed, using regex only');
    }
  }
  
  allItems.sort((a, b) => b.start - a.start);
  console.log(`✅ Total PII items after filtering: ${allItems.length}`);
  return allItems;
}

// IMAGE PII DETECTION
async function detectImagePII(imageBlob) {
  console.log('🖼️ Analyzing image with vision AI...');
  
  try {
    const availability = await LanguageModel.availability({
      expectedInputs: [
        { type: "text", languages: ["en"] },
        { type: "image" }
      ],
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    });
    
    if (availability === 'no') {
      console.log('⚠️ Vision AI not available');
      return { hasSensitive: false, types: [] };
    }
    
    console.log('📸 Creating Vision AI session...');
    const session = await LanguageModel.create({
      expectedInputs: [
        { type: "text", languages: ["en"] },
        { type: "image" }
      ],
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    });
    
    console.log('🔍 Prompting with image (File/Blob)...');
    const result = await session.prompt([{
      role: 'user',
      content: [
        { 
          type: 'text', 
          value: `Detect sensitive documents (credit cards, IDs, passports, medical cards).

Response JSON: {"sensitive": true/false, "types": ["credit_card"]}

JSON:` 
        },
        { type: 'image', value: imageBlob }
      ]
    }]);
    
    await session.destroy();
    
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        hasSensitive: data.sensitive === true,
        types: data.types || []
      };
    }
    
    return { hasSensitive: false, types: [] };
    
  } catch (error) {
    console.error('❌ Vision AI error:', error);
    return { hasSensitive: false, types: [] };
  }
}

// UI Functions
function showIndicator(text, color = '#10B981', keepExpanded = false, isAnalyzing = false) {
  let indicator = document.getElementById('clipshield-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'clipshield-indicator';
    indicator.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      background: ${color}; color: white; padding: 10px 16px;
      border-radius: 20px; font-size: 13px; font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: system-ui, -apple-system, sans-serif;
      cursor: pointer; transition: all 0.3s ease;
      display: flex; align-items: center; gap: 10px;
      user-select: none;
      opacity: 1.0;
    `;
    
    const toggleSwitch = document.createElement('div');
    toggleSwitch.id = 'clipshield-toggle';
    toggleSwitch.style.cssText = `
      width: 36px; height: 20px; background: rgba(255,255,255,0.3);
      border-radius: 10px; position: relative; transition: all 0.2s ease;
      flex-shrink: 0;
    `;
    
    const toggleKnob = document.createElement('div');
    toggleKnob.id = 'clipshield-toggle-knob';
    toggleKnob.style.cssText = `
      width: 16px; height: 16px; background: white;
      border-radius: 50%; position: absolute; top: 2px;
      left: 2px; transition: all 0.2s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    `;
    
    toggleSwitch.appendChild(toggleKnob);
    indicator.appendChild(toggleSwitch);
    
    const textSpan = document.createElement('span');
    textSpan.id = 'clipshield-text';
    indicator.appendChild(textSpan);
    
    // Add hover listeners
    indicator.addEventListener('mouseenter', () => {
      if (isIndicatorMinimized) {
        expandIndicator();
      }
    });
    
    indicator.addEventListener('mouseleave', () => {
      if (isIndicatorMinimized) {
        minimizeIndicator();
      }
    });
    
    indicator.addEventListener('click', async () => {
      isProtectionEnabled = !isProtectionEnabled;
      
      // Save state to storage
      try {
        await chrome.storage.local.set({ isProtectionEnabled });
      } catch (error) {
        console.error('Failed to save protection state:', error);
      }
      
      const siteConfig = getSiteConfig();
      updateIndicator(
        `ClipShield ${isProtectionEnabled ? 'Active' : 'Disabled'} on ${siteConfig.name}`,
        isProtectionEnabled ? '#10B981' : '#6B7280',
        isProtectionEnabled
      );
      // Keep expanded briefly after toggle
      scheduleMinimize(2000);
    });
    
    document.body.appendChild(indicator);
  }
  
  // Expand indicator when showing new status
  if (isIndicatorMinimized) {
    expandIndicator();
  }
  
  const textSpan = indicator.querySelector('#clipshield-text');
  const toggleKnob = indicator.querySelector('#clipshield-toggle-knob');
  
  if (textSpan) textSpan.textContent = text;
  indicator.style.background = color;
  
  // Update toggle position
  if (toggleKnob) {
    toggleKnob.style.left = isProtectionEnabled ? '18px' : '2px';
  }
  
  // Schedule auto-minimize unless explicitly told to keep expanded
  if (!keepExpanded) {
    scheduleMinimize();
  }
}

function updateIndicator(text, color, enabled) {
  const indicator = document.getElementById('clipshield-indicator');
  const textSpan = indicator?.querySelector('#clipshield-text');
  const toggleKnob = indicator?.querySelector('#clipshield-toggle-knob');
  
  if (textSpan) textSpan.textContent = text;
  if (indicator) indicator.style.background = color;
  if (toggleKnob) {
    toggleKnob.style.left = enabled ? '18px' : '2px';
  }
}

function scheduleMinimize(delay = 3000) {
  // Clear existing timer
  if (indicatorMinimizeTimer) {
    clearTimeout(indicatorMinimizeTimer);
  }
  
  // Schedule new minimize
  indicatorMinimizeTimer = setTimeout(() => {
    minimizeIndicator();
  }, delay);
}

function minimizeIndicator() {
  const indicator = document.getElementById('clipshield-indicator');
  if (!indicator) return;
  
  const textSpan = indicator.querySelector('#clipshield-text');
  const toggleSwitch = indicator.querySelector('#clipshield-toggle');
  
  // Hide text and toggle
  if (textSpan) textSpan.style.display = 'none';
  if (toggleSwitch) toggleSwitch.style.display = 'none';
  
  // Make indicator small and circular
  indicator.style.width = '40px';
  indicator.style.height = '40px';
  indicator.style.padding = '0';
  indicator.style.justifyContent = 'center';
  indicator.style.borderRadius = '50%';
  
  // Add CS text for badge
  let badgeText = indicator.querySelector('#clipshield-badge-text');
  if (!badgeText) {
    badgeText = document.createElement('span');
    badgeText.id = 'clipshield-badge-text';
    badgeText.style.cssText = `
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
    `;
    badgeText.textContent = 'CS';
    indicator.appendChild(badgeText);
  }
  badgeText.style.display = 'block';
  
  // Add subtle pulse animation if protection is active
  if (isProtectionEnabled) {
    indicator.style.animation = 'clipshield-pulse 3s ease-in-out infinite';
    
    // Add keyframes if not already added
    if (!document.getElementById('clipshield-pulse-keyframes')) {
      const style = document.createElement('style');
      style.id = 'clipshield-pulse-keyframes';
      style.textContent = `
        @keyframes clipshield-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  isIndicatorMinimized = true;
}

function expandIndicator() {
  const indicator = document.getElementById('clipshield-indicator');
  if (!indicator) return;
  
  const textSpan = indicator.querySelector('#clipshield-text');
  const toggleSwitch = indicator.querySelector('#clipshield-toggle');
  const badgeText = indicator.querySelector('#clipshield-badge-text');
  
  // Show text and toggle
  if (textSpan) textSpan.style.display = 'block';
  if (toggleSwitch) toggleSwitch.style.display = 'flex';
  if (badgeText) badgeText.style.display = 'none';
  
  // Restore full size
  indicator.style.width = 'auto';
  indicator.style.height = 'auto';
  indicator.style.padding = '10px 16px';
  indicator.style.borderRadius = '20px';
  indicator.style.animation = 'none';
  
  isIndicatorMinimized = false;
}

function insertText(siteConfig, text) {
  console.log('📝 Attempting to insert text with selector:', siteConfig.selector);
  
  const input = document.querySelector(siteConfig.selector);
  if (!input) {
    console.warn('⚠️ Input element not found for selector:', siteConfig.selector);
    console.log('   Available textareas:', document.querySelectorAll('textarea').length);
    console.log('   Available contenteditable:', document.querySelectorAll('[contenteditable="true"]').length);
    return;
  }
  
  console.log('📝 Found input element:', input.tagName, input.className);
  console.log('📝 Text to insert:', text.substring(0, 50) + '...');
  
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    // Standard textarea/input - insert at cursor position
    const currentValue = input.value || '';
    const cursorPos = input.selectionStart !== undefined ? input.selectionStart : currentValue.length;
    const beforeCursor = currentValue.slice(0, cursorPos);
    const afterCursor = currentValue.slice(input.selectionEnd || cursorPos);
    
    // Insert text at cursor
    input.value = beforeCursor + text + afterCursor;
    
    // Move cursor to end of inserted text
    const newCursorPos = cursorPos + text.length;
    input.setSelectionRange(newCursorPos, newCursorPos);
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('✓ Inserted into textarea at position', cursorPos);
    
  } else if (input.contentEditable === 'true') {
    // ContentEditable - insert at selection
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      
      // Move cursor after inserted text
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      input.textContent = text;
    }
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('✓ Inserted into contentEditable');
    
  } else if (input.tagName === 'RICH-TEXTAREA') {
    // Gemini's rich-textarea
    const innerInput = input.querySelector('textarea, [contenteditable]');
    if (innerInput) {
      if (innerInput.tagName === 'TEXTAREA') {
        const currentValue = innerInput.value || '';
        const cursorPos = innerInput.selectionStart !== undefined ? innerInput.selectionStart : currentValue.length;
        const beforeCursor = currentValue.slice(0, cursorPos);
        const afterCursor = currentValue.slice(innerInput.selectionEnd || cursorPos);
        
        innerInput.value = beforeCursor + text + afterCursor;
        
        const newCursorPos = cursorPos + text.length;
        innerInput.setSelectionRange(newCursorPos, newCursorPos);
        
        innerInput.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('✓ Inserted into rich-textarea textarea at position', cursorPos);
      } else {
        // ContentEditable inside rich-textarea
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          innerInput.textContent = text;
        }
        
        innerInput.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('✓ Inserted into rich-textarea contentEditable');
      }
    }
  }
  
  input.focus();
}

// PASTE HANDLERS (Prevent default, analyze, insert sanitized)
async function handleTextPaste(event, siteConfig) {
  const text = event.clipboardData.getData('text/plain');
  if (!text || !isProtectionEnabled) return;
  
  // Check for power user bypass
  if (bypassNextPaste) {
    console.log('⚡ Bypass shortcut detected - pasting unredacted');
    bypassNextPaste = false; // Reset flag
    
    // Allow normal paste to proceed
    showIndicator('⚡ Bypassed protection', '#F59E0B', false);
    setTimeout(() => {
      showIndicator(`ClipShield Active on ${siteConfig.name}`);
    }, 2000);
    return; // Let browser handle paste normally
  }
  
  console.log('📋 Paste detected, checking for PII...');
  
  // PREVENT DEFAULT - block native paste to avoid PII flash
  event.preventDefault();
  event.stopPropagation();
  
  // Show analyzing indicator
  showIndicator('⏳ Analyzing...', '#8b5cf6', false, true);
  await setAnalyzing(true);
  
  // Check if we have cached analysis
  const cached = clipboardCache.get(text);
  
  let textToInsert;
  let piiCount = 0;
  
  if (cached) {
    console.log('⚡ Using cached analysis');
    textToInsert = cached.sanitized;
    piiCount = cached.piiItems.length;
  } else {
    // Check if pre-analysis is already running for this text
    const textHash = clipboardCache.hash(text);
    if (pendingAnalysis && pendingAnalysis.hash === textHash) {
      console.log('⏳ Waiting for pre-analysis to complete...');
      await pendingAnalysis.promise;
      
      // Now check cache again (pre-analysis should have populated it)
      const nowCached = clipboardCache.get(text);
      if (nowCached) {
        console.log('✅ Pre-analysis completed, using result');
        textToInsert = nowCached.sanitized;
        piiCount = nowCached.piiItems.length;
      } else {
        // Fallback: pre-analysis failed somehow, analyze now
        console.log('⚠️ Pre-analysis cache miss, analyzing now...');
        const piiItems = await detectTextPII(text);
        piiCount = piiItems.length;
        
        if (piiItems.length === 0) {
          textToInsert = text;
          clipboardCache.set(text, text, []);
        } else {
          const result = placeholderManager.sanitizeText(text, piiItems);
          textToInsert = result.sanitizedText;
          clipboardCache.set(text, textToInsert, piiItems);
        }
      }
    } else {
      // No pre-analysis running, analyze now
      console.log('🔍 Analyzing pasted text...');
      const piiItems = await detectTextPII(text);
      piiCount = piiItems.length;
      
      if (piiItems.length === 0) {
        textToInsert = text;
        clipboardCache.set(text, text, []);
      } else {
        const result = placeholderManager.sanitizeText(text, piiItems);
        textToInsert = result.sanitizedText;
        clipboardCache.set(text, textToInsert, piiItems);
      }
    }
  }
  
  await setAnalyzing(false);
  
  // Insert the text (sanitized or original)
  console.log(`📝 Inserting ${piiCount > 0 ? 'sanitized' : 'original'} text...`);
  insertText(siteConfig, textToInsert);
  
  // Update stats and indicator
  await updateStats(piiCount);
  
  if (piiCount > 0) {
    showIndicator(`🔒 Protected ${piiCount} items`, '#10B981');
  } else {
    showIndicator(`ClipShield Active on ${siteConfig.name}`);
  }
  
  setTimeout(() => {
    showIndicator(`ClipShield Active on ${siteConfig.name}`);
  }, 2000);
}

async function handleImagePaste(event, siteConfig) {
  if (!isProtectionEnabled) return;
  
  const items = event.clipboardData.items;
  if (!items) return;
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // Safety check - item might be undefined on some sites (Gemini, Claude)
    if (!item || !item.type) continue;
    
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      event.stopPropagation();
      
      showIndicator('⏳ Analyzing image...', '#8b5cf6', false, true);
      await setAnalyzing(true);
      
      // Try to get file directly first
      let imageFile = item.getAsFile();
      
      // Fallback: If getAsFile() returns null (e.g., from web Copy Image),
      // try the modern Clipboard API
      if (!imageFile) {
        console.log('📋 getAsFile() returned null, trying Clipboard API fallback...');
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const clipboardItem of clipboardItems) {
            for (const type of clipboardItem.types) {
              if (type.startsWith('image/')) {
                const blob = await clipboardItem.getType(type);
                imageFile = new File([blob], 'image.png', { type });
                console.log('✅ Got image from Clipboard API');
                break;
              }
            }
            if (imageFile) break;
          }
        } catch (error) {
          console.log('⚠️ Clipboard API fallback failed:', error);
        }
      }
      
      // Check if we successfully got the file
      if (!imageFile) {
        console.log('❌ Could not get image file from clipboard');
        await setAnalyzing(false);
        showIndicator(`ClipShield Active on ${siteConfig.name}`);
        continue;
      }
      
      const detection = await detectImagePII(imageFile);
      await setAnalyzing(false);
      
      if (!detection.hasSensitive) {
        console.log('✅ Image is safe - allowing paste');
        
        // CRITICAL: Set flag BEFORE dispatching to prevent double-paste
        isProcessingPaste = true;
        
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(imageFile);
        
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        
        event.target.dispatchEvent(pasteEvent);
        
        // Reset flag after a brief delay
        setTimeout(() => { isProcessingPaste = false; }, 100);
        
        showIndicator(`ClipShield Active on ${siteConfig.name}`);
        return;
      }
      
      console.log('⚠️ Sensitive image detected:', detection.types);
      showIndicator('⚠️ Sensitive image detected', '#F59E0B');
      
      const userChoice = await showWarningModal(detection.types);
      
      if (userChoice) {
        console.log('✅ User chose to share - allowing paste');
        
        // CRITICAL: Set flag BEFORE dispatching to prevent double-paste
        isProcessingPaste = true;
        
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(imageFile);
        
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        
        event.target.dispatchEvent(pasteEvent);
        
        // Reset flag after a brief delay
        setTimeout(() => { isProcessingPaste = false; }, 100);
      } else {
        console.log('❌ User cancelled');
      }
      
      showIndicator(`ClipShield Active on ${siteConfig.name}`);
      break;
    }
  }
}

// BACKGROUND PRE-ANALYSIS ON COPY
async function preAnalyzeFromCopy(copiedText) {
  try {
    if (!copiedText || copiedText.length === 0) return;
    
    // Check if already cached
    if (clipboardCache.get(copiedText)) {
      console.log('⚡ Text already analyzed (cached)');
      return;
    }
    
    // Check if analysis already in progress for this text
    const textHash = clipboardCache.hash(copiedText);
    if (pendingAnalysis && pendingAnalysis.hash === textHash) {
      console.log('⏳ Analysis already in progress, skipping duplicate');
      return;
    }
    
    console.log('🔍 Pre-analyzing copied text in background...');
    
    // Mark as pending
    const analysisPromise = (async () => {
      // Run PII detection
      const piiItems = await detectTextPII(copiedText);
      
      if (piiItems.length === 0) {
        // Cache with no PII
        clipboardCache.set(copiedText, copiedText, []);
        console.log('✅ Pre-analysis complete: No PII found');
      } else {
        // Sanitize and cache
        const { sanitizedText } = placeholderManager.sanitizeText(copiedText, piiItems);
        clipboardCache.set(copiedText, sanitizedText, piiItems);
        console.log(`✅ Pre-analysis complete: ${piiItems.length} PII items detected`);
      }
    })();
    
    pendingAnalysis = { hash: textHash, promise: analysisPromise };
    
    // Wait for completion and clear pending
    await analysisPromise;
    if (pendingAnalysis && pendingAnalysis.hash === textHash) {
      pendingAnalysis = null;
    }
    
  } catch (error) {
    console.log('ℹ️ Pre-analysis error:', error.message);
    pendingAnalysis = null;
  }
}

// COPY EVENT PRE-ANALYSIS (Universal - works on all sites)
function setupCopyPreAnalysis() {
  document.addEventListener('copy', async (event) => {
    try {
      // Get the copied text from the clipboard event
      const copiedText = event.clipboardData?.getData('text/plain');
      
      if (!copiedText || !isProtectionEnabled) return;
      
      console.log('📋 Copy detected, starting background analysis...');
      
      // Start pre-analysis immediately (non-blocking)
      preAnalyzeFromCopy(copiedText).catch(err => {
        console.log('Pre-analysis failed:', err);
      });
      
    } catch (error) {
      console.log('Copy event handling error:', error);
    }
  }, { capture: true });
  
  console.log('✅ Copy event pre-analysis enabled (universal)');
}

// COPY/CUT RESTORATION
function setupCopyRestoration() {
  const handleCopyOrCut = (event) => {
    try {
      const selectedText = window.getSelection().toString();
      
      if (!selectedText || !placeholderManager.hasPlaceholders(selectedText)) {
        // Not a placeholder restoration - this is a normal copy/cut
        // Pre-analysis will be handled by the copy event listener
        return;
      }
      
      console.log(`🔓 Restoring original data (${event.type})`);
      
      // For CUT: Let the browser handle DOM removal, we just fix the clipboard
      // For COPY: Prevent default to avoid copying placeholders
      if (event.type === 'copy') {
        event.preventDefault();
        event.stopPropagation();
      }
      
      const { restoredText } = placeholderManager.restoreText(selectedText);
      
      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', restoredText);
        
        // For cut, we need to prevent the default clipboard but let DOM removal happen
        if (event.type === 'cut') {
          event.preventDefault(); // Prevent placeholder from going to clipboard
          // The DOM removal will happen via execCommand below
          document.execCommand('delete'); // Remove the selected text
        }
      }
      
      // Also pre-analyze the restored text for future paste
      if (event.clipboardData) {
        setTimeout(() => preAnalyzeFromCopy(restoredText), 100);
      }
      
    } catch (error) {
      console.error(`❌ ${event.type} restoration error:`, error);
    }
  };
  
  // Listen to BOTH copy and cut events
  document.addEventListener('copy', handleCopyOrCut, { capture: true, passive: false });
  document.addEventListener('cut', handleCopyOrCut, { capture: true, passive: false });
}

// DRAG & DROP PROTECTION
function setupDragDropProtection() {
  // Handle dragstart - restore placeholders when dragging
  document.addEventListener('dragstart', (event) => {
    if (!isProtectionEnabled) return;
    
    try {
      const selectedText = window.getSelection().toString();
      
      if (!selectedText || !placeholderManager.hasPlaceholders(selectedText)) {
        return; // No placeholders to restore
      }
      
      console.log('🔓 Restoring original data (drag)');
      
      const { restoredText } = placeholderManager.restoreText(selectedText);
      
      // Set the drag data with restored text
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', restoredText);
        event.dataTransfer.effectAllowed = 'copyMove';
      }
      
    } catch (error) {
      console.error('❌ Drag restoration error:', error);
    }
  }, { capture: true });
  
  // Handle drop events - intercept and analyze images
  document.addEventListener('drop', async (event) => {
    if (!isProtectionEnabled) return;
    
    const items = event.dataTransfer?.items;
    if (!items) return;
    
    // Check if any dropped items are images
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        hasImage = true;
        break;
      }
    }
    
    if (!hasImage) return;
    
    console.log('🖼️ Image drop detected');
    event.preventDefault();
    event.stopPropagation();
    
    const siteConfig = getSiteConfig();
    if (!siteConfig) return;
    
    showIndicator('⏳ Analyzing dropped image...', '#8b5cf6', false, true);
    await setAnalyzing(true);
    
    // Get the first image file
    let imageFile = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageFile = items[i].getAsFile();
        break;
      }
    }
    
    if (!imageFile) {
      console.log('❌ Could not get dropped image file');
      await setAnalyzing(false);
      showIndicator(`ClipShield Active on ${siteConfig.name}`);
      return;
    }
    
    const detection = await detectImagePII(imageFile);
    await setAnalyzing(false);
    
    if (!detection.hasSensitive) {
      console.log('✅ Dropped image is safe - allowing drop');
      
      // Create new drop event to re-trigger
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(imageFile);
      
      const dropEvent = new DragEvent('drop', {
        dataTransfer: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      
      event.target.dispatchEvent(dropEvent);
      showIndicator(`ClipShield Active on ${siteConfig.name}`);
      return;
    }
    
    console.log('⚠️ Sensitive content in dropped image:', detection.types);
    showIndicator('⚠️ Sensitive image detected', '#F59E0B');
    
    const userChoice = await showWarningModal(detection.types);
    
    if (userChoice) {
      console.log('✅ User chose to share dropped image');
      
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(imageFile);
      
      const dropEvent = new DragEvent('drop', {
        dataTransfer: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      
      event.target.dispatchEvent(dropEvent);
    } else {
      console.log('❌ User cancelled image drop');
    }
    
    showIndicator(`ClipShield Active on ${siteConfig.name}`);
  }, { capture: true });
  
  console.log('✅ Drag & drop protection enabled');
}

// FILE ATTACHMENT PROTECTION
function setupFileUploadProtection() {
  // Monitor for file input changes
  document.addEventListener('change', async (event) => {
    // Skip if we're programmatically re-triggering (prevents infinite loops)
    if (isProcessingFileUpload) {
      console.log('⏭️ Skipping re-triggered file upload');
      return;
    }
    
    if (!isProtectionEnabled) return;
    
    const target = event.target;
    
    // Check if this is a file input
    if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
    
    const files = target.files;
    if (!files || files.length === 0) return;
    
    // Check if any files are images
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    
    console.log(`🖼️ File upload detected: ${imageFiles.length} image(s)`);
    
    const siteConfig = getSiteConfig();
    if (!siteConfig) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    showIndicator('⏳ Analyzing uploaded image...', '#8b5cf6', false, true);
    await setAnalyzing(true);
    
    // Analyze the first image
    const imageFile = imageFiles[0];
    const detection = await detectImagePII(imageFile);
    await setAnalyzing(false);
    
    if (!detection.hasSensitive) {
      console.log('✅ Uploaded image is safe - allowing upload');
      showIndicator(`ClipShield Active on ${siteConfig.name}`);
      
      // Set flag to prevent infinite loop
      isProcessingFileUpload = true;
      
      // Update file input with the analyzed file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(imageFile);
      target.files = dataTransfer.files;
      
      // Trigger change event again
      target.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Reset flag after a brief delay
      setTimeout(() => { isProcessingFileUpload = false; }, 100);
      return;
    }
    
    console.log('⚠️ Sensitive content in uploaded image:', detection.types);
    showIndicator('⚠️ Sensitive image detected', '#F59E0B');
    
    const userChoice = await showWarningModal(detection.types);
    
    if (userChoice) {
      console.log('✅ User chose to upload sensitive image');
      
      // Set flag to prevent infinite loop
      isProcessingFileUpload = true;
      
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(imageFile);
      target.files = dataTransfer.files;
      
      // Trigger change event again
      target.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Reset flag after a brief delay
      setTimeout(() => { isProcessingFileUpload = false; }, 100);
    } else {
      console.log('❌ User cancelled image upload');
      // Clear the file input
      target.value = '';
    }
    
    showIndicator(`ClipShield Active on ${siteConfig.name}`);
  }, { capture: true });
  
  console.log('✅ File upload protection enabled');
}

// Warm AI session in background for faster subsequent analysis
async function warmAISessionInBackground() {
  if (isWarmingSession || warmAISession || !aiAvailable) return;
  
  isWarmingSession = true;
  
  try {
    console.log('🔥 Warming AI session in background...');
    const systemPrompt = await buildAISystemPrompt();
    
    warmAISession = await LanguageModel.create({
      initialPrompts: [systemPrompt],
      temperature: 0.1,
      topK: 1,
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    });
    
    console.log('✅ AI session warmed and ready');
  } catch (error) {
    console.log('⚠️ Failed to warm AI session:', error);
    warmAISession = null;
  } finally {
    isWarmingSession = false;
  }
}

// Setup visibility monitoring to warm session when tab becomes visible
function setupVisibilityMonitoring() {
  // Track last clipboard read to debounce
  let lastClipboardRead = 0;
  const CLIPBOARD_READ_COOLDOWN = 2000; // 2 seconds
  
  // Warm AI session on visibility change (doesn't require focus)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (aiAvailable && !warmAISession && !isWarmingSession) {
        console.log('👁️ Tab visible, warming AI session...');
        warmAISessionInBackground().catch(err => {
          console.log('Failed to warm session on visibility:', err);
        });
      }
    }
  });
  
  // Read clipboard on focus (requires document to have focus)
  window.addEventListener('focus', async () => {
    const now = Date.now();
    
    // Debounce: only read clipboard once per 2 seconds
    if (now - lastClipboardRead < CLIPBOARD_READ_COOLDOWN) {
      return;
    }
    lastClipboardRead = now;
    
    // Document is now focused - clipboard reading will work!
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.length > 0 && text.length < 50000) {
        console.log('📋 Document focused, pre-analyzing clipboard...');
        await preAnalyzeFromCopy(text);
      }
    } catch (error) {
      // Silently fail - clipboard might be empty, inaccessible, or user denied
      console.log('ℹ️ Could not read clipboard on focus:', error.message);
    }
  }, { capture: true });
  
  console.log('✅ Visibility monitoring enabled');
}

// Setup power user bypass shortcut
function setupBypassShortcut() {
  document.addEventListener('keydown', (event) => {
    // Check for Cmd+Shift+V (Mac) or Ctrl+Shift+V (Windows/Linux)
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const correctModifier = isMac ? event.metaKey : event.ctrlKey;
    
    if (correctModifier && event.shiftKey && event.key === 'v') {
      console.log('⚡ Bypass shortcut detected (Cmd/Ctrl+Shift+V)');
      bypassNextPaste = true;
      
      // Show brief indicator
      showIndicator('⚡ Next paste will bypass protection', '#F59E0B', false);
      
      // Reset flag after 3 seconds if no paste happens
      setTimeout(() => {
        if (bypassNextPaste) {
          bypassNextPaste = false;
          const siteConfig = getSiteConfig();
          if (siteConfig) {
            showIndicator(`ClipShield Active on ${siteConfig.name}`);
          }
        }
      }, 3000);
    }
  }, { capture: true });
  
  console.log('✅ Power user bypass shortcut enabled (Cmd/Ctrl+Shift+V)');
}

// Load custom websites and merge with defaults
async function loadCustomWebsites() {
  try {
    const result = await chrome.storage.sync.get(['customWebsites']);
    const customWebsites = result.customWebsites || [];
    
    // Start with default configs
    SITE_CONFIGS = { ...DEFAULT_SITE_CONFIGS };
    
    // Add custom websites with generic selector
    for (const url of customWebsites) {
      const hostname = extractHostname(url);
      if (hostname && !SITE_CONFIGS[hostname]) {
        SITE_CONFIGS[hostname] = {
          name: hostname,
          selector: 'textarea, div[contenteditable="true"], input[type="text"]'
        };
      }
    }
    
    console.log('✅ Loaded custom websites:', Object.keys(SITE_CONFIGS));
  } catch (error) {
    console.log('Could not load custom websites:', error);
  }
}

// Load PII type settings
async function loadPiiTypeSettings() {
  try {
    const result = await chrome.storage.sync.get(['piiTypes']);
    
    // Default: all types enabled
    const defaultPiiTypes = {
      miscellaneous: true,  // AI smart detection (currency, etc.)
      email: true,
      phone: true,
      name: true,
      company: true,
      address: true,
      ssn: true,
      ni_number: true,
      passport: true,
      credit_card: true,
      account_number: true,
      sort_code: true,
      nhs_number: true,
      medical_id: true,
      contract_id: true,
      invoice: true,
      employee_id: true,
      uk_postcode: true,
      us_zip: true,
      dob: true,
      ip_address: true
    };
    
    enabledPiiTypes = result.piiTypes || defaultPiiTypes;
    console.log('✅ PII type settings loaded:', enabledPiiTypes);
  } catch (error) {
    console.log('Could not load PII type settings:', error);
    // Enable all by default
    enabledPiiTypes = {};
  }
}

// Listen for storage changes to keep state in sync
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.isProtectionEnabled) {
    const newState = changes.isProtectionEnabled.newValue;
    isProtectionEnabled = newState !== undefined ? newState : true;
    
    const siteConfig = getSiteConfig();
    if (siteConfig) {
      updateIndicator(
        `ClipShield ${isProtectionEnabled ? 'Active' : 'Disabled'} on ${siteConfig.name}`,
        isProtectionEnabled ? '#10B981' : '#6B7280',
        isProtectionEnabled
      );
    }
    console.log(`🔄 Protection state synced from storage: ${isProtectionEnabled ? 'ENABLED' : 'DISABLED'}`);
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleProtection') {
    isProtectionEnabled = message.enabled;
    const siteConfig = getSiteConfig();
    if (siteConfig) {
      updateIndicator(
        `ClipShield ${isProtectionEnabled ? 'Active' : 'Disabled'} on ${siteConfig.name}`,
        isProtectionEnabled ? '#10B981' : '#6B7280',
        isProtectionEnabled
      );
    }
  }
  
  if (message.action === 'settingsUpdated') {
    // Reload PII type settings
    loadPiiTypeSettings();
    // Clear clipboard cache since detection rules changed
    clipboardCache.entries.clear();
    // Clear custom patterns cache in PII detector
    if (window.PIIDetector && window.PIIDetector.clearCustomPatternsCache) {
      window.PIIDetector.clearCustomPatternsCache();
    }
    console.log('✅ Settings reloaded, all caches cleared');
  }
  
  if (message.action === 'clearCache') {
    // Manually clear all caches
    clipboardCache.entries.clear();
    if (window.PIIDetector && window.PIIDetector.clearCustomPatternsCache) {
      window.PIIDetector.clearCustomPatternsCache();
    }
    console.log('✅ All caches manually cleared');
    sendResponse({ success: true });
  }
});

// INITIALIZE
async function initialize() {
  // Load custom websites FIRST before checking site config
  await loadCustomWebsites();
  
  const siteConfig = getSiteConfig();
  if (!siteConfig) {
    console.log('ℹ️ Not a supported AI site');
    return;
  }
  
  console.log(`✓ ClipShield active on ${siteConfig.name}`);
  
  // Load protection state from storage
  try {
    const result = await chrome.storage.local.get(['isProtectionEnabled']);
    // Default to true if not set
    isProtectionEnabled = result.isProtectionEnabled !== undefined ? result.isProtectionEnabled : true;
    console.log(`🔒 Protection state loaded: ${isProtectionEnabled ? 'ENABLED' : 'DISABLED'}`);
  } catch (error) {
    console.log('Could not load protection state:', error);
  }
  
  // Load session stats
  await loadSessionStats();
  
  // Load PII type settings
  await loadPiiTypeSettings();
  
  showIndicator(`ClipShield ${isProtectionEnabled ? 'Active' : 'Disabled'} on ${siteConfig.name}`);
  
  // Check AI availability
  if (typeof LanguageModel !== 'undefined') {
    try {
      const availability = await LanguageModel.availability();
      if (availability !== 'no') {
        aiAvailable = true;
        console.log('✅ AI available');
      }
    } catch (error) {
      console.log('⚠️ AI not available');
    }
  }
  
  // Setup paste listener
  document.addEventListener('paste', async (event) => {
    // Skip if we're programmatically re-pasting (prevents infinite loops)
    if (isProcessingPaste) {
      console.log('⏭️ Skipping re-pasted content');
      return;
    }
    
    const hasImage = Array.from(event.clipboardData.items).some(
      item => item.type.startsWith('image/')
    );
    
    if (hasImage) {
      await handleImagePaste(event, siteConfig);
    } else {
      await handleTextPaste(event, siteConfig);
    }
  }, true);
  
  setupCopyRestoration();
  setupDragDropProtection();
  setupFileUploadProtection();
  setupCopyPreAnalysis();
  setupVisibilityMonitoring();
  setupBypassShortcut();
  
  // Warm initial session if AI is available
  if (aiAvailable) {
    setTimeout(() => {
      warmAISessionInBackground().catch(err => {
        console.log('Failed to warm initial session:', err);
      });
    }, 1000); // Delay 1s to not slow down page load
  }
  
  console.log('✅ ClipShield initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
