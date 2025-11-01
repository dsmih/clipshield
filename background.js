// ClipShield Background Service Worker
// Handles AI initialization and PII detection using Chrome's Prompt API

class AIManager {
  constructor() {
    this.session = null;
    this.isInitialized = false;
    this.isAvailable = false;
    this.initializationPromise = null;
  }

  async initialize() {
    // Return existing initialization if in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }

  async _doInitialize() {
    try {
      console.log('🤖 ClipShield Background: Checking AI availability...');
      console.log('  - Checking chrome.languageModel:', !!chrome.languageModel);

      // Note: chrome.languageModel is NOT available in service workers
      // AI functionality has been moved to content.js where it IS available
      if (!chrome.languageModel) {
        console.log('ℹ️ AI APIs not available in service worker context');
        console.log('  - This is expected behavior');
        console.log('  - AI detection runs in content.js instead');
        this.isAvailable = false;
        return false;
      }

      console.log('✓ AI APIs found in service worker (unexpected!)');

      // Check capabilities
      const capabilities = await chrome.languageModel.capabilities();
      console.log('📊 AI Capabilities:', JSON.stringify(capabilities, null, 2));

      if (capabilities.available === 'no') {
        console.log('⚠️ Gemini Nano not available on this device');
        this.isAvailable = false;
        return false;
      }

      if (capabilities.available === 'after-download') {
        console.log('📥 Gemini Nano needs download...');
      }

      console.log('🔨 Creating AI session...');
      
      // Create AI session with optimal settings for PII detection
      this.session = await chrome.languageModel.create({
        temperature: 0.1,  // Low temperature for consistency
        topK: 1            // Most confident result
      });

      console.log('✓ Session created:', !!this.session);

      this.isInitialized = true;
      this.isAvailable = true;
      console.log('✅ Gemini Nano initialized in service worker!');
      return true;

    } catch (error) {
      console.log('ℹ️ AI initialization in service worker failed (expected):', error.message);
      console.log('  - AI detection runs in content.js instead');
      this.isAvailable = false;
      this.isInitialized = false;
      return false;
    }
  }

  buildPrompt(text) {
    return `You are a PII (Personally Identifiable Information) detection expert. Analyze the following text and identify ALL personally identifiable information.

Return ONLY valid JSON in this exact format (no other text):
{
  "pii": [
    {"type": "name", "value": "exact text from input", "start": 0, "end": 10},
    {"type": "email", "value": "exact text from input", "start": 15, "end": 30}
  ]
}

PII types to detect:
- name: Full names (first + last name). DO NOT include company names, product names, or public figures mentioned in news context.
- email: Email addresses
- phone: Phone numbers (any format)
- address: Physical addresses (street addresses, not just cities)
- ssn: Social Security Numbers or National ID numbers
- credit_card: Credit card numbers
- dob: Dates of birth (when clearly referring to a person's birthdate)
- medical_id: Medical record numbers or patient IDs

Important rules:
1. Only detect actual PII about real people
2. Ignore company names like "Apple" or "Microsoft" 
3. Ignore generic examples like "user@example.com"
4. For names, only flag if it appears to be a real person's name with context
5. Return exact text as it appears in the input

Text to analyze:
${text}

JSON:`;
  }

  parseAIResponse(response) {
    try {
      // Extract JSON from response (AI might add extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const data = JSON.parse(jsonMatch[0]);

      if (!data.pii || !Array.isArray(data.pii)) {
        throw new Error('Invalid response format');
      }

      console.log(`🔍 AI detected ${data.pii.length} PII items`);
      return data.pii;

    } catch (error) {
      console.error('❌ Failed to parse AI response:', error);
      throw error;
    }
  }

  async detectPII(text) {
    if (!this.isInitialized || !this.session) {
      throw new Error('AI not initialized');
    }

    try {
      const prompt = this.buildPrompt(text);
      console.log('🔍 Sending text to AI for PII detection...');

      // Set timeout for AI processing (10 seconds max)
      const response = await Promise.race([
        this.session.prompt(prompt),
        this.timeout(10000)
      ]);

      console.log('📝 AI Response received:', response.substring(0, 200) + '...');
      
      const piiItems = this.parseAIResponse(response);
      return piiItems;

    } catch (error) {
      console.error('❌ AI PII detection failed:', error);
      throw error;
    }
  }

  timeout(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI detection timeout')), ms)
    );
  }
}

// Global AI manager instance
const aiManager = new AIManager();

// Message handler for content script communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Background received message:', request.action);
  
  if (request.action === 'detectPII') {
    console.log('🔍 Starting PII detection in background...');
    console.log('  - Text length:', request.text?.length || 0);
    console.log('  - AI initialized:', aiManager.isInitialized);
    console.log('  - AI available:', aiManager.isAvailable);
    
    handleDetectPII(request.text)
      .then(result => {
        console.log('✅ Detection complete:', result.mode);
        sendResponse(result);
      })
      .catch(error => {
        console.error('❌ Detection error:', error);
        sendResponse({ error: error.message });
      });
    return true; // Keep message channel open for async response
  }

  if (request.action === 'checkAIStatus') {
    sendResponse({
      isAvailable: aiManager.isAvailable,
      isInitialized: aiManager.isInitialized
    });
    return true;
  }
  
});

async function handleDetectPII(text) {
  try {
    // Try to initialize AI if not already done
    if (!aiManager.isInitialized) {
      await aiManager.initialize();
    }

    // If AI available, use it
    if (aiManager.isAvailable) {
      const piiItems = await aiManager.detectPII(text);
      return {
        success: true,
        mode: 'ai',
        piiItems: piiItems
      };
    } else {
      // AI not available, signal to use regex fallback
      return {
        success: false,
        mode: 'fallback',
        reason: 'AI not available'
      };
    }

  } catch (error) {
    console.error('❌ Detection failed:', error);
    return {
      success: false,
      mode: 'fallback',
      reason: error.message
    };
  }
}

// Initialize AI on extension load
console.log('🚀 ClipShield Background Service Worker started');
aiManager.initialize().catch(err => {
  console.warn('⚠️ Initial AI setup failed, will use regex fallback:', err);
});
