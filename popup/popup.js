// ClipShield Popup - With Animations

let isProtectionEnabled = true;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('ClipShield popup loaded');
  
  // Create floating particles
  createParticles();
  
  // Load protection state
  await loadProtectionState();
  
  // Load and animate stats
  await loadStats();
  
  // Set up power button
  setupPowerButton();
  
  // Set up links
  setupLinks();
  
  // Listen for storage changes to update stats in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.stats) {
      const stats = changes.stats.newValue;
      animateCounter('protected-count', stats.totalProtected || 0);
      animateCounter('paste-count', stats.totalPastes || 0);
    }
    
    if (namespace === 'local' && changes.isAnalyzing) {
      const liveBadge = document.getElementById('live-badge');
      if (changes.isAnalyzing.newValue) {
        liveBadge.classList.add('active');
      } else {
        liveBadge.classList.remove('active');
      }
    }
  });
});

function createParticles() {
  const particlesContainer = document.getElementById('particles');
  const particleCount = 15;
  
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    
    // Random horizontal position
    particle.style.left = Math.random() * 100 + '%';
    
    // Random drift amount
    const drift = (Math.random() - 0.5) * 100;
    particle.style.setProperty('--drift', drift + 'px');
    
    // Random animation duration (8-15 seconds)
    const duration = 8 + Math.random() * 7;
    particle.style.animationDuration = duration + 's';
    
    // Random delay
    particle.style.animationDelay = Math.random() * -duration + 's';
    
    particlesContainer.appendChild(particle);
  }
}

async function loadStats() {
  try {
    const result = await chrome.storage.local.get(['stats']);
    const stats = result.stats || {
      totalProtected: 0,
      totalPastes: 0
    };
    
    // Set target values
    document.getElementById('protected-count').dataset.target = stats.totalProtected || 0;
    document.getElementById('paste-count').dataset.target = stats.totalPastes || 0;
    
    // Animate from 0 to actual values
    setTimeout(() => {
      animateCounter('protected-count', stats.totalProtected || 0);
      animateCounter('paste-count', stats.totalPastes || 0);
    }, 100);
    
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function animateCounter(elementId, targetValue) {
  const element = document.getElementById(elementId);
  const currentValue = parseInt(element.textContent) || 0;
  
  if (currentValue === targetValue) return;
  
  const duration = 800; // ms
  const steps = 30;
  const stepValue = (targetValue - currentValue) / steps;
  const stepDuration = duration / steps;
  
  let current = currentValue;
  let step = 0;
  
  const timer = setInterval(() => {
    step++;
    current += stepValue;
    
    if (step >= steps) {
      element.textContent = targetValue;
      clearInterval(timer);
    } else {
      element.textContent = Math.round(current);
    }
  }, stepDuration);
}

async function loadProtectionState() {
  try {
    const result = await chrome.storage.local.get(['isProtectionEnabled']);
    // Default to true if not set
    isProtectionEnabled = result.isProtectionEnabled !== undefined ? result.isProtectionEnabled : true;
    
    // Update UI based on stored state
    updatePowerButtonUI();
  } catch (error) {
    console.error('Failed to load protection state:', error);
  }
}

function updatePowerButtonUI() {
  const powerButton = document.getElementById('power-button');
  const powerStatus = document.getElementById('power-status');
  
  if (isProtectionEnabled) {
    powerButton.classList.remove('inactive');
    powerButton.classList.add('active', 'pulse-active');
    powerStatus.textContent = 'AI PRIVACY ACTIVE';
  } else {
    powerButton.classList.remove('active', 'pulse-active');
    powerButton.classList.add('inactive');
    powerStatus.textContent = 'AI PRIVACY INACTIVE';
  }
}

function setupPowerButton() {
  const powerButton = document.getElementById('power-button');
  
  powerButton.addEventListener('click', async () => {
    isProtectionEnabled = !isProtectionEnabled;
    
    // Save state to storage
    try {
      await chrome.storage.local.set({ isProtectionEnabled });
    } catch (error) {
      console.error('Failed to save protection state:', error);
    }
    
    // Update UI
    updatePowerButtonUI();
    
    // Send message to all tabs with content script
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'toggleProtection',
          enabled: isProtectionEnabled
        }).catch(() => {
          // Silently fail if content script not loaded on this tab
        });
      });
    });
  });
}

function setupLinks() {
  // Setup guide modal
  document.getElementById('setup-link').addEventListener('click', (e) => {
    e.preventDefault();
    showSetupModal();
  });
  
  // Settings modal
  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    showSettingsModal();
  });
  
  // How it works modal
  document.getElementById('how-it-works').addEventListener('click', (e) => {
    e.preventDefault();
    showHowItWorksModal();
  });
  
  // GitHub link
  document.getElementById('github-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
      url: 'https://github.com/dsmih/clipshield'
    });
  });
}

function showSetupModal() {
  const modal = document.getElementById('setup-modal');
  modal.style.display = 'flex';
  
  // Close button
  document.getElementById('close-setup').addEventListener('click', () => {
    modal.style.display = 'none';
  });
  
  // Backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
  
  // Fade in
  setTimeout(() => {
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s';
    setTimeout(() => modal.style.opacity = '1', 10);
  }, 0);
}

function showHowItWorksModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close">×</button>
      <h2 class="modal-title">How ClipShield Works</h2>
      <ol class="modal-steps">
        <li>
          <strong>You paste</strong> → ClipShield scans locally on your computer 
          <span style="display: block; font-size: 12px; color: #9CA3AF; margin-top: 4px;">
            (we never receive your data - all processing happens on your device)
          </span>
        </li>
        <li>
          <strong>Sensitive data found?</strong> → Automatically replaced with safe-to-share, uniquely identifiable codes
          <span style="display: block; font-size: 12px; color: #9CA3AF; margin-top: 4px;">
            (e.g., your email becomes [EMAIL_a3b2])
          </span>
        </li>
        <li>
          <strong>AI receives safe text</strong> → No personal info is shared
          <span style="display: block; font-size: 12px; color: #9CA3AF; margin-top: 4px;">
            (AI services never see your real data)
          </span>
        </li>
        <li>
          <strong>You copy AI's response</strong> → Codes restore to originals
          <span style="display: block; font-size: 12px; color: #9CA3AF; margin-top: 4px;">
            (seamless restoration of your sensitive information)
          </span>
        </li>
      </ol>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modal);
    }
  });
  
  // Close button
  const closeBtn = modal.querySelector('.modal-close');
  closeBtn.addEventListener('click', () => closeModal(modal));
  
  // Fade in
  setTimeout(() => {
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s';
    setTimeout(() => modal.style.opacity = '1', 10);
  }, 0);
}

function closeModal(modal) {
  modal.style.opacity = '0';
  setTimeout(() => modal.remove(), 200);
}

// Load and display custom patterns in the settings modal
async function loadCustomPatternsIntoModal(modal) {
  const patterns = await window.CustomPatterns.getAllPatterns();
  const listContainer = modal.querySelector('#custom-patterns-list');
  
  if (patterns.length === 0) {
    listContainer.innerHTML = '<div class="no-patterns">No custom patterns yet. Click "+ Add Custom Pattern" to create one.</div>';
    return;
  }
  
  listContainer.innerHTML = patterns.map(pattern => {
    let modeBadge = 'REGEX';
    if (pattern.mode === 'simple' || pattern.mode === 'exact') modeBadge = 'EXACT';
    else if (pattern.mode === 'smart_examples') modeBadge = 'AI-SMART';
    
    return `
    <div class="pattern-item" data-pattern-id="${pattern.id}">
      <div class="pattern-header">
        <div class="pattern-info">
          <div class="pattern-name">${pattern.name}</div>
          <div class="pattern-description">${pattern.description || ''}</div>
          <div class="pattern-mode-badge">${modeBadge}</div>
        </div>
        <div class="pattern-controls">
          <label class="toggle-switch">
            <input type="checkbox" ${pattern.enabled ? 'checked' : ''} class="pattern-toggle" data-pattern-id="${pattern.id}">
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-icon" title="Edit" data-action="edit" data-pattern-id="${pattern.id}">✏️</button>
          <button class="btn-icon" title="Delete" data-action="delete" data-pattern-id="${pattern.id}">🗑️</button>
        </div>
      </div>
      <div class="pattern-preview">
        ${(pattern.mode === 'simple' || pattern.mode === 'exact' || pattern.mode === 'smart_examples')
          ? `Items: ${pattern.items.slice(0, 3).join(', ')}${pattern.items.length > 3 ? '...' : ''}`
          : `Pattern: ${pattern.pattern.substring(0, 50)}${pattern.pattern.length > 50 ? '...' : ''}`
        }
      </div>
    </div>
  `;
  }).join('');
}

// Setup event listeners for custom pattern controls
function setupCustomPatternListeners(modal) {
  const listContainer = modal.querySelector('#custom-patterns-list');
  
  // Toggle pattern enabled/disabled
  listContainer.addEventListener('change', async (e) => {
    if (e.target.classList.contains('pattern-toggle')) {
      const patternId = e.target.dataset.patternId;
      await window.CustomPatterns.updatePattern(patternId, { enabled: e.target.checked });
      console.log(`Pattern ${patternId} ${e.target.checked ? 'enabled' : 'disabled'}`);
    }
  });
  
  // Edit and delete buttons
  listContainer.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    
    const action = button.dataset.action;
    const patternId = button.dataset.patternId;
    
    if (action === 'edit') {
      await showPatternEditorModal(patternId);
      await loadCustomPatternsIntoModal(modal);
    } else if (action === 'delete') {
      if (confirm('Are you sure you want to delete this pattern?')) {
        await window.CustomPatterns.deletePattern(patternId);
        await loadCustomPatternsIntoModal(modal);
      }
    }
  });
  
  // Add pattern button
  modal.querySelector('#add-custom-pattern-btn').addEventListener('click', async () => {
    await showPatternEditorModal(null);
    await loadCustomPatternsIntoModal(modal);
  });
  
  // Show templates button
  modal.querySelector('#show-templates-btn').addEventListener('click', () => {
    showTemplatesModal(modal);
  });
  
  // Export button
  modal.querySelector('#export-patterns-btn').addEventListener('click', async () => {
    const json = await window.CustomPatterns.exportPatterns();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clipshield-patterns-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  
  // Import button
  modal.querySelector('#import-patterns-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        const text = await file.text();
        const result = await window.CustomPatterns.importPatterns(text);
        if (result.success) {
          alert(`Successfully imported ${result.count} pattern(s). Total patterns: ${result.total}`);
          await loadCustomPatternsIntoModal(modal);
        } else {
          alert(`Import failed: ${result.error}`);
        }
      }
    };
    input.click();
  });
}

// Show pattern editor modal (for add/edit)
async function showPatternEditorModal(patternId) {
  let existingPattern = null;
  if (patternId) {
    const patterns = await window.CustomPatterns.getAllPatterns();
    existingPattern = patterns.find(p => p.id === patternId);
  }
  
  const isEdit = !!existingPattern;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  
  const itemsText = existingPattern && existingPattern.mode === 'simple' 
    ? existingPattern.items.join('\n') 
    : '';
  
  modal.innerHTML = `
    <div class="modal-content pattern-editor-modal">
      <button class="modal-close">×</button>
      <h2 class="modal-title">${isEdit ? '✏️ Edit' : '➕ Add'} Custom Pattern</h2>
      
      <div class="form-group">
        <label>Pattern Name *</label>
        <input type="text" id="pattern-name" class="form-input" placeholder="e.g., Client List" value="${existingPattern?.name || ''}">
      </div>
      
      <div class="form-group">
        <label>Description</label>
        <input type="text" id="pattern-description" class="form-input" placeholder="What this pattern protects" value="${existingPattern?.description || ''}">
      </div>
      
      <div class="form-group">
        <label>Detection Mode (Regex + AI Hybrid)</label>
        <div class="radio-group">
          <label class="radio-item">
            <input type="radio" name="pattern-mode" value="exact" ${!existingPattern || existingPattern.mode === 'exact' || existingPattern.mode === 'simple' ? 'checked' : ''}>
            <span>Exact Matches</span>
            <span class="radio-description">Only match exact strings (e.g., "Acme Corp")</span>
          </label>
          <label class="radio-item">
            <input type="radio" name="pattern-mode" value="smart_examples" ${existingPattern?.mode === 'smart_examples' ? 'checked' : ''}>
            <span>Smart Examples (AI) 🤖</span>
            <span class="radio-description">Show examples, AI learns the pattern (e.g., "123/abc/456" → catches similar)</span>
          </label>
          <label class="radio-item">
            <input type="radio" name="pattern-mode" value="regex" ${existingPattern?.mode === 'regex' ? 'checked' : ''}>
            <span>Regex Pattern</span>
            <span class="radio-description">Advanced: custom regex for power users</span>
          </label>
        </div>
      </div>
      
      <div class="form-group" id="simple-mode-fields" style="display: ${!existingPattern || existingPattern.mode === 'simple' ? 'block' : 'none'}">
        <label>Items to Protect (one per line) *</label>
        <textarea id="pattern-items" class="form-textarea" placeholder="Acme Corp&#10;Globex Industries&#10;Initech" rows="5">${itemsText}</textarea>
      </div>
      
      <div class="form-group" id="regex-mode-fields" style="display: ${existingPattern?.mode === 'regex' ? 'block' : 'none'}">
        <label>Regular Expression Pattern *</label>
        <input type="text" id="pattern-regex" class="form-input" placeholder="\\bEMP-\\d{5}\\b" value="${existingPattern?.mode === 'regex' ? existingPattern.pattern : ''}">
        <div class="field-hint">Use JavaScript regex syntax. Example: \\bEMP-\\d{5}\\b for employee IDs</div>
      </div>
      
      <div class="form-group">
        <label class="checkbox-inline">
          <input type="checkbox" id="pattern-case-sensitive" ${existingPattern?.caseSensitive ? 'checked' : ''}>
          <span>Case Sensitive</span>
        </label>
      </div>
      
      <div class="form-group">
        <label>Test Pattern</label>
        <textarea id="pattern-test-text" class="form-textarea" placeholder="Paste sample text to test pattern matching..." rows="3"></textarea>
        <button class="btn-secondary" id="test-pattern-btn">🧪 Test Pattern</button>
        <div id="test-results" class="test-results"></div>
      </div>
      
      <div class="modal-actions">
        <button class="btn-secondary" id="pattern-cancel">Cancel</button>
        <button class="btn-primary" id="pattern-save">${isEdit ? 'Update' : 'Create'} Pattern</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Mode switching
  modal.querySelectorAll('[name="pattern-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const simpleFields = modal.querySelector('#simple-mode-fields');
      const regexFields = modal.querySelector('#regex-mode-fields');
      const itemsLabel = simpleFields.querySelector('label');
      
      if (e.target.value === 'exact' || e.target.value === 'smart_examples') {
        simpleFields.style.display = 'block';
        regexFields.style.display = 'none';
        
        // Update label based on mode
        if (e.target.value === 'exact') {
          itemsLabel.textContent = 'Exact Matches (one per line) *';
          simpleFields.querySelector('textarea').placeholder = 'Acme Corp\nGlobex Industries\nInitech';
        } else {
          itemsLabel.textContent = 'Example Patterns (one per line) *';
          simpleFields.querySelector('textarea').placeholder = '123/abc/456\n999/xyz/111\n(AI learns from examples)';
        }
      } else {
        simpleFields.style.display = 'none';
        regexFields.style.display = 'block';
      }
    });
  });
  
  // Test pattern button
  modal.querySelector('#test-pattern-btn').addEventListener('click', () => {
    const mode = modal.querySelector('[name="pattern-mode"]:checked').value;
    const testText = modal.querySelector('#pattern-test-text').value;
    const caseSensitive = modal.querySelector('#pattern-case-sensitive').checked;
    const resultsDiv = modal.querySelector('#test-results');
    
    if (!testText) {
      resultsDiv.innerHTML = '<div class="test-warning">Please enter test text</div>';
      return;
    }
    
    let patternToTest;
    if (mode === 'exact' || mode === 'smart_examples') {
      const items = modal.querySelector('#pattern-items').value.split('\n').filter(i => i.trim());
      if (items.length === 0) {
        resultsDiv.innerHTML = '<div class="test-error">Please enter at least one example</div>';
        return;
      }
      patternToTest = {
        pattern: window.CustomPatterns.simpleListToRegex(items, caseSensitive),
        caseSensitive
      };
      
      // Add note for Smart Examples mode
      if (mode === 'smart_examples') {
        resultsDiv.innerHTML = '<div class="test-info">ℹ️ Testing regex match only. AI will also detect similar patterns when enabled.</div>';
      }
    } else {
      const regex = modal.querySelector('#pattern-regex').value;
      if (!regex) {
        resultsDiv.innerHTML = '<div class="test-error">Please enter a regex pattern</div>';
        return;
      }
      const validation = window.CustomPatterns.validateRegex(regex);
      if (!validation.valid) {
        resultsDiv.innerHTML = `<div class="test-error">Invalid regex: ${validation.error}</div>`;
        return;
      }
      patternToTest = { pattern: regex, caseSensitive };
    }
    
    const result = window.CustomPatterns.testPattern(patternToTest, testText);
    
    if (result.success) {
      if (result.count === 0) {
        let message = '<div class="test-info">No regex matches found</div>';
        if (mode === 'smart_examples') {
          message += '<div class="test-warning">💡 AI may still detect this as a similar pattern when the extension runs</div>';
        }
        resultsDiv.innerHTML = message;
      } else {
        let message = `
          <div class="test-success">✅ Found ${result.count} regex match(es):</div>
          <div class="test-matches">${result.matches.map(m => `<code>${m.value}</code>`).join(', ')}</div>
        `;
        if (mode === 'smart_examples') {
          message += '<div class="test-info">💡 AI will also detect similar patterns</div>';
        }
        resultsDiv.innerHTML = message;
      }
    } else {
      resultsDiv.innerHTML = `<div class="test-error">Test failed: ${result.error}</div>`;
    }
  });
  
  // Cancel button
  modal.querySelector('#pattern-cancel').addEventListener('click', () => closeModal(modal));
  modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
  
  // Save button
  modal.querySelector('#pattern-save').addEventListener('click', async () => {
    const name = modal.querySelector('#pattern-name').value.trim();
    const description = modal.querySelector('#pattern-description').value.trim();
    const mode = modal.querySelector('[name="pattern-mode"]:checked').value;
    const caseSensitive = modal.querySelector('#pattern-case-sensitive').checked;
    
    if (!name) {
      alert('Please enter a pattern name');
      return;
    }
    
    const patternData = {
      name,
      description,
      mode,
      caseSensitive
    };
    
    if (mode === 'exact' || mode === 'smart_examples') {
      const items = modal.querySelector('#pattern-items').value.split('\n').filter(i => i.trim());
      if (items.length === 0) {
        alert('Please enter at least one item');
        return;
      }
      patternData.items = items;
    } else {
      const regex = modal.querySelector('#pattern-regex').value.trim();
      if (!regex) {
        alert('Please enter a regex pattern');
        return;
      }
      const validation = window.CustomPatterns.validateRegex(regex);
      if (!validation.valid) {
        alert(`Invalid regex: ${validation.error}`);
        return;
      }
      patternData.pattern = regex;
    }
    
    try {
      if (isEdit) {
        await window.CustomPatterns.updatePattern(patternId, patternData);
      } else {
        await window.CustomPatterns.createPattern(patternData);
      }
      closeModal(modal);
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  });
  
  // Backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modal);
    }
  });
  
  // Fade in
  setTimeout(() => {
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s';
    setTimeout(() => modal.style.opacity = '1', 10);
  }, 0);
}

// Show templates selection modal
function showTemplatesModal(settingsModal) {
  const templates = window.CustomPatterns.getPatternTemplates();
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content templates-modal">
      <button class="modal-close">×</button>
      <h2 class="modal-title">📋 Pattern Templates</h2>
      <div class="templates-description">Select a template to get started quickly</div>
      
      <div class="templates-list">
        ${templates.map((template, index) => `
          <div class="template-item" data-template-index="${index}">
            <div class="template-header">
              <div class="template-name">${template.name}</div>
              <button class="btn-primary btn-sm" data-template-index="${index}">Use Template</button>
            </div>
            <div class="template-description">${template.description}</div>
            <div class="template-example">
              <strong>Example:</strong> ${template.example}
            </div>
            <div class="template-mode-badge">${template.mode === 'simple' ? 'LIST' : 'REGEX'}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Use template buttons
  modal.querySelectorAll('[data-template-index]').forEach(btn => {
    if (btn.tagName === 'BUTTON') {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.dataset.templateIndex);
        const template = templates[index];
        
        try {
          await window.CustomPatterns.createPattern(template);
          closeModal(modal);
          await loadCustomPatternsIntoModal(settingsModal);
        } catch (error) {
          alert(`Error creating pattern: ${error.message}`);
        }
      });
    }
  });
  
  // Close button
  modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
  
  // Backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modal);
    }
  });
  
  // Fade in
  setTimeout(() => {
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s';
    setTimeout(() => modal.style.opacity = '1', 10);
  }, 0);
}

async function showSettingsModal() {
  // Load current settings
  const result = await chrome.storage.sync.get(['piiTypes', 'customWebsites']);
  
  // Default PII types (all enabled by default)
  const defaultPiiTypes = {
    miscellaneous: true,  // AI smart detection
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
  
  const piiTypes = result.piiTypes || defaultPiiTypes;
  const customWebsites = result.customWebsites || [];
  
  // Default websites (cannot be removed)
  const defaultWebsites = ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content settings-modal">
      <button class="modal-close">×</button>
      <h2 class="modal-title">⚙️ ClipShield Settings</h2>
      
      <!-- PII Types Section -->
      <div class="settings-section">
        <div class="settings-section-title">Protected Information Types</div>
        <div class="checkbox-group" id="pii-types">
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.miscellaneous ? 'checked' : ''} data-type="miscellaneous">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>🤖 AI Smart Detection (Misc)</div>
              <div class="checkbox-description">Let AI decide what other sensitive information to protect.</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.email ? 'checked' : ''} data-type="email">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>📧 Email Addresses</div>
              <div class="checkbox-description">user@example.com</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.phone ? 'checked' : ''} data-type="phone">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>📱 Phone Numbers</div>
              <div class="checkbox-description">+1 555-123-4567</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.name ? 'checked' : ''} data-type="name">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>👤 Names</div>
              <div class="checkbox-description">Full person names</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.company ? 'checked' : ''} data-type="company">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>🏢 Company/Organization Names</div>
              <div class="checkbox-description">Business partners, enterprises</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.address ? 'checked' : ''} data-type="address">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>🏠 Physical Addresses</div>
              <div class="checkbox-description">123 Main Street</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.ssn ? 'checked' : ''} data-type="ssn">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>🔢 SSN / National IDs</div>
              <div class="checkbox-description">123-45-6789</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.credit_card ? 'checked' : ''} data-type="credit_card">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>💳 Credit Cards</div>
              <div class="checkbox-description">1234-5678-9012-3456</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.medical_id ? 'checked' : ''} data-type="medical_id">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>🏥 Medical IDs</div>
              <div class="checkbox-description">NHS numbers, patient IDs</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.dob ? 'checked' : ''} data-type="dob">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>📅 Date of Birth</div>
              <div class="checkbox-description">01/15/1990</div>
            </div>
          </label>
          
          <label class="checkbox-item">
            <input type="checkbox" ${piiTypes.contract_id ? 'checked' : ''} data-type="contract_id">
            <div class="checkbox-custom"></div>
            <div class="checkbox-label">
              <div>📄 Contract/Project IDs</div>
              <div class="checkbox-description">Enterprise identifiers</div>
            </div>
          </label>
        </div>
      </div>
      
      <!-- Custom Patterns Section -->
      <div class="settings-section">
        <div class="settings-section-title">
          Custom Data Types
          <button class="btn-help" id="show-templates-btn" title="Load Template">📋 Templates</button>
        </div>
        <div class="settings-section-description">
          Define your own patterns to protect client lists, custom IDs, project names, or any other sensitive data.
        </div>
        
        <div class="custom-patterns-list" id="custom-patterns-list">
          <!-- Patterns will be loaded here -->
        </div>
        
        <button class="btn-secondary full-width" id="add-custom-pattern-btn">+ Add Custom Pattern</button>
        
        <div class="pattern-actions">
          <button class="btn-text" id="import-patterns-btn">📥 Import</button>
          <button class="btn-text" id="export-patterns-btn">📤 Export</button>
        </div>
      </div>
      
      <!-- Websites Section -->
      <div class="settings-section">
        <div class="settings-section-title">Protected Websites</div>
        <div class="website-list" id="website-list">
          ${defaultWebsites.map(site => `
            <div class="website-item default">
              <span class="website-name">${site}</span>
              <span class="website-badge">DEFAULT</span>
            </div>
          `).join('')}
          ${customWebsites.map((site, index) => `
            <div class="website-item">
              <span class="website-name">${site}</span>
              <button class="remove-website" data-index="${index}">Remove</button>
            </div>
          `).join('')}
        </div>
        
        <div class="add-website-form">
          <input 
            type="text" 
            class="website-input" 
            id="new-website-input"
            placeholder="example.com or *.company.com"
          >
          <button class="add-website-btn" id="add-website-btn">+ Add</button>
        </div>
      </div>
      
      <!-- Actions -->
      <div class="settings-actions">
        <button class="btn-secondary" id="settings-cancel">Cancel</button>
        <button class="btn-primary" id="settings-save">Save Settings</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Setup remove website buttons
  modal.querySelectorAll('.remove-website').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      customWebsites.splice(index, 1);
      
      // Re-render website list
      const websiteList = modal.querySelector('#website-list');
      websiteList.innerHTML = `
        ${defaultWebsites.map(site => `
          <div class="website-item default">
            <span class="website-name">${site}</span>
            <span class="website-badge">DEFAULT</span>
          </div>
        `).join('')}
        ${customWebsites.map((site, idx) => `
          <div class="website-item">
            <span class="website-name">${site}</span>
            <button class="remove-website" data-index="${idx}">Remove</button>
          </div>
        `).join('')}
      `;
      
      // Re-attach listeners
      websiteList.querySelectorAll('.remove-website').forEach(newBtn => {
        newBtn.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.index);
          customWebsites.splice(idx, 1);
          e.target.closest('.website-item').remove();
        });
      });
    });
  });
  
  // Add website button
  const addBtn = modal.querySelector('#add-website-btn');
  const websiteInput = modal.querySelector('#new-website-input');
  
  // Helper to clean URL
  const cleanUrl = (url) => {
    try {
      // Remove protocol
      let cleaned = url.replace(/^https?:\/\//, '');
      // Remove www.
      cleaned = cleaned.replace(/^www\./, '');
      // Remove path and query
      cleaned = cleaned.split('/')[0].split('?')[0];
      return cleaned;
    } catch (e) {
      return url;
    }
  };
  
  addBtn.addEventListener('click', () => {
    const rawInput = websiteInput.value.trim();
    if (!rawInput) return;
    
    const website = cleanUrl(rawInput);
    if (website && !customWebsites.includes(website) && !defaultWebsites.includes(website)) {
      customWebsites.push(website);
      
      // Add to list
      const websiteList = modal.querySelector('#website-list');
      const newItem = document.createElement('div');
      newItem.className = 'website-item';
      newItem.innerHTML = `
        <span class="website-name">${website}</span>
        <button class="remove-website" data-index="${customWebsites.length - 1}">Remove</button>
      `;
      websiteList.appendChild(newItem);
      
      // Attach remove listener
      newItem.querySelector('.remove-website').addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        customWebsites.splice(index, 1);
        newItem.remove();
      });
      
      websiteInput.value = '';
    }
  });
  
  // Enter key to add website
  websiteInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addBtn.click();
    }
  });
  
  // Close button
  modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
  
  // Cancel button
  modal.querySelector('#settings-cancel').addEventListener('click', () => closeModal(modal));
  
  // Save button
  modal.querySelector('#settings-save').addEventListener('click', async () => {
    // Collect PII type settings
    const newPiiTypes = {};
    modal.querySelectorAll('#pii-types input[type="checkbox"]').forEach(checkbox => {
      newPiiTypes[checkbox.dataset.type] = checkbox.checked;
    });
    
    // Save to storage
    await chrome.storage.sync.set({
      piiTypes: newPiiTypes,
      customWebsites: customWebsites
    });
    
    console.log('Settings saved:', { piiTypes: newPiiTypes, customWebsites });
    
    // Notify content scripts to reload settings
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'settingsUpdated'
        }).catch(() => {});
      });
    });
    
    closeModal(modal);
  });
  
  // Backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modal);
    }
  });
  
  // Load custom patterns
  await loadCustomPatternsIntoModal(modal);
  
  // Setup custom pattern event listeners
  setupCustomPatternListeners(modal);
  
  // Fade in
  setTimeout(() => {
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s';
    setTimeout(() => modal.style.opacity = '1', 10);
  }, 0);
}
