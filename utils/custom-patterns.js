// ClipShield Custom Pattern Management
// Handles user-defined custom data types and patterns

/**
 * Pattern object structure:
 * {
 *   id: string (unique identifier),
 *   name: string (display name),
 *   description: string (optional),
 *   mode: 'exact' | 'smart_examples' | 'regex',
 *     - exact: list of exact string matches
 *     - smart_examples: example-based AI pattern learning
 *     - regex: custom regex pattern
 *   pattern: string (the actual regex pattern),
 *   items: string[] (for exact/smart_examples modes),
 *   caseSensitive: boolean,
 *   enabled: boolean,
 *   createdAt: number (timestamp)
 * }
 */

/**
 * Generate unique ID for pattern
 */
function generatePatternId() {
  return 'pattern_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Validate regex pattern
 */
function validateRegex(pattern) {
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/**
 * Convert simple list to regex pattern
 */
function simpleListToRegex(items, caseSensitive = false) {
  if (!items || items.length === 0) {
    return '';
  }
  
  // Escape special regex characters in each item
  const escapedItems = items.map(item => 
    item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  
  // Join with | (OR) and wrap in word boundaries
  const pattern = `\\b(${escapedItems.join('|')})\\b`;
  
  return pattern;
}

/**
 * Create a new custom pattern
 */
async function createPattern(patternData) {
  const pattern = {
    id: generatePatternId(),
    name: patternData.name || 'Unnamed Pattern',
    description: patternData.description || '',
    mode: patternData.mode || 'exact',
    caseSensitive: patternData.caseSensitive || false,
    enabled: patternData.enabled !== undefined ? patternData.enabled : true,
    createdAt: Date.now()
  };
  
  // Handle backward compatibility: 'simple' -> 'exact'
  if (pattern.mode === 'simple') {
    pattern.mode = 'exact';
  }
  
  if (pattern.mode === 'exact' || pattern.mode === 'smart_examples') {
    pattern.items = patternData.items || [];
    pattern.pattern = simpleListToRegex(pattern.items, pattern.caseSensitive);
  } else {
    pattern.pattern = patternData.pattern || '';
    pattern.items = [];
  }
  
  // Validate the pattern
  const validation = validateRegex(pattern.pattern);
  if (!validation.valid) {
    throw new Error(`Invalid regex pattern: ${validation.error}`);
  }
  
  // Save to storage
  const result = await chrome.storage.sync.get(['customPatterns']);
  const customPatterns = result.customPatterns || [];
  customPatterns.push(pattern);
  
  await chrome.storage.sync.set({ customPatterns });
  console.log('✅ Custom pattern created:', pattern);
  
  return pattern;
}

/**
 * Update existing pattern
 */
async function updatePattern(patternId, updates) {
  const result = await chrome.storage.sync.get(['customPatterns']);
  const customPatterns = result.customPatterns || [];
  
  const index = customPatterns.findIndex(p => p.id === patternId);
  if (index === -1) {
    throw new Error('Pattern not found');
  }
  
  const pattern = customPatterns[index];
  
  // Apply updates
  if (updates.name !== undefined) pattern.name = updates.name;
  if (updates.description !== undefined) pattern.description = updates.description;
  if (updates.mode !== undefined) {
    pattern.mode = updates.mode;
    // Handle backward compatibility
    if (pattern.mode === 'simple') pattern.mode = 'exact';
  }
  if (updates.caseSensitive !== undefined) pattern.caseSensitive = updates.caseSensitive;
  if (updates.enabled !== undefined) pattern.enabled = updates.enabled;
  
  // Handle backward compatibility for existing patterns
  if (pattern.mode === 'simple') pattern.mode = 'exact';
  
  if (updates.mode === 'exact' || updates.mode === 'smart_examples' || 
      pattern.mode === 'exact' || pattern.mode === 'smart_examples') {
    if (updates.items !== undefined) {
      pattern.items = updates.items;
      pattern.pattern = simpleListToRegex(pattern.items, pattern.caseSensitive);
    }
  } else {
    if (updates.pattern !== undefined) {
      pattern.pattern = updates.pattern;
    }
  }
  
  // Validate the pattern
  const validation = validateRegex(pattern.pattern);
  if (!validation.valid) {
    throw new Error(`Invalid regex pattern: ${validation.error}`);
  }
  
  customPatterns[index] = pattern;
  await chrome.storage.sync.set({ customPatterns });
  console.log('✅ Custom pattern updated:', pattern);
  
  return pattern;
}

/**
 * Delete pattern
 */
async function deletePattern(patternId) {
  const result = await chrome.storage.sync.get(['customPatterns']);
  const customPatterns = result.customPatterns || [];
  
  const filtered = customPatterns.filter(p => p.id !== patternId);
  await chrome.storage.sync.set({ customPatterns: filtered });
  console.log('✅ Custom pattern deleted:', patternId);
}

/**
 * Get all custom patterns
 */
async function getAllPatterns() {
  const result = await chrome.storage.sync.get(['customPatterns']);
  return result.customPatterns || [];
}

/**
 * Get enabled patterns only
 */
async function getEnabledPatterns() {
  const patterns = await getAllPatterns();
  return patterns.filter(p => p.enabled);
}

/**
 * Test pattern against sample text
 */
function testPattern(pattern, sampleText) {
  try {
    const flags = pattern.caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(pattern.pattern, flags);
    
    const matches = [];
    let match;
    
    while ((match = regex.exec(sampleText)) !== null) {
      matches.push({
        value: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
    
    return {
      success: true,
      matches: matches,
      count: matches.length
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * Export patterns as JSON
 */
async function exportPatterns() {
  const patterns = await getAllPatterns();
  const exportData = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    patterns: patterns
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * Import patterns from JSON
 */
async function importPatterns(jsonString, options = {}) {
  try {
    const data = JSON.parse(jsonString);
    
    if (!data.patterns || !Array.isArray(data.patterns)) {
      throw new Error('Invalid import format: missing patterns array');
    }
    
    // Validate all patterns first
    for (const pattern of data.patterns) {
      const validation = validateRegex(pattern.pattern);
      if (!validation.valid) {
        throw new Error(`Invalid pattern "${pattern.name}": ${validation.error}`);
      }
    }
    
    // Get existing patterns
    const result = await chrome.storage.sync.get(['customPatterns']);
    let customPatterns = result.customPatterns || [];
    
    if (options.replace) {
      // Replace all patterns
      customPatterns = data.patterns.map(p => ({
        ...p,
        id: generatePatternId(), // Generate new IDs
        createdAt: Date.now()
      }));
    } else {
      // Merge patterns (add new ones)
      const newPatterns = data.patterns.map(p => ({
        ...p,
        id: generatePatternId(),
        createdAt: Date.now()
      }));
      customPatterns = [...customPatterns, ...newPatterns];
    }
    
    await chrome.storage.sync.set({ customPatterns });
    console.log('✅ Patterns imported:', customPatterns.length);
    
    return {
      success: true,
      count: data.patterns.length,
      total: customPatterns.length
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * Get pattern templates for common use cases
 */
function getPatternTemplates() {
  return [
    {
      name: 'Client/Company List',
      description: 'Protect specific client or company names',
      mode: 'simple',
      items: ['Acme Corp', 'Globex Industries', 'Initech'],
      caseSensitive: false,
      example: 'Our client Acme Corp requested...'
    },
    {
      name: 'Employee ID Format',
      description: 'Employee IDs in format EMP-12345',
      mode: 'regex',
      pattern: '\\bEMP-\\d{5}\\b',
      caseSensitive: false,
      example: 'Employee EMP-12345 submitted the report'
    },
    {
      name: 'Project Codenames',
      description: 'Internal project names',
      mode: 'simple',
      items: ['Project Phoenix', 'Operation Atlas', 'Initiative Horizon'],
      caseSensitive: true,
      example: 'Project Phoenix is launching next month'
    },
    {
      name: 'Custom ID Format',
      description: 'IDs in format XXX-YYYY-ZZZZ',
      mode: 'regex',
      pattern: '\\b[A-Z]{3}-\\d{4}-[A-Z]{4}\\b',
      caseSensitive: false,
      example: 'Reference number ABC-1234-DEFG'
    },
    {
      name: 'Internal URLs',
      description: 'Internal website URLs',
      mode: 'regex',
      pattern: 'https?://[\\w.-]*\\.internal\\.company\\.com[\\w/.-]*',
      caseSensitive: false,
      example: 'Check https://dashboard.internal.company.com'
    },
    {
      name: 'Product Codenames',
      description: 'Secret product names',
      mode: 'simple',
      items: ['Titan', 'Nebula', 'Quantum'],
      caseSensitive: true,
      example: 'The Titan release is scheduled for Q2'
    }
  ];
}

// Export to window object
window.CustomPatterns = {
  createPattern,
  updatePattern,
  deletePattern,
  getAllPatterns,
  getEnabledPatterns,
  testPattern,
  exportPatterns,
  importPatterns,
  getPatternTemplates,
  validateRegex,
  simpleListToRegex
};
