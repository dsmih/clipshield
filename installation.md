# Installation and Testing Instructions for Google Chrome Built-in AI Hackathon Judges

## Requirements
- **Chrome 138+** (Dev/Canary channel for AI features)
- Windows, macOS, or Linux

## Quick Setup (5-8 minutes)

### Step 1: Enable Chrome AI (3 minutes)

**Important:** These flags must be enabled first, then Chrome restarted.

1. Open `chrome://flags/#optimization-guide-on-device-model`
   - Set to: **Enabled BypassPerfRequirement**

2. Open `chrome://flags/#prompt-api-for-gemini-nano`
   - Set to: **Enabled**

3. **Restart Chrome completely** (Quit, not just close windows)

### Step 2: Download AI Model (2-5 minutes)

1. Open `chrome://components/`
2. Find "**Optimization Guide On Device Model**"
3. Click "**Check for update**"
4. Wait for download to complete (shows version number when done)

### Step 3: Install Extension (2 minutes)

1. Download/clone this repository
2. Open `chrome://extensions/`
3. Enable "**Developer mode**" (toggle in top-right)
4. Click "**Load unpacked**"
5. Select the `clipshield` folder

### Step 4: Test It! (30 seconds)

1. Visit https://chatgpt.com (or claude.ai, gemini.google.com)
2. You should see green indicator in bottom right (or in extension popup): "🔒 ClipShield Active on [Site]"
3. Try pasting: `"My email is test@example.com and phone is 555-1234"`
4. Should see: `"My email is [EMAIL_xxx] and phone is [PHONE_xxx]"`

**Success!** ✓




## Troubleshooting

**If extension doesn't activate:**
1. Check flags are enabled (Step 1)
2. Check AI model downloaded (Step 2)
3. Restart Chrome completely
4. Try opening ChatGPT in new tab

**If AI detection seems slow:**
- First paste is always slower (2-4s) - this is normal as the AI API session loads/warms
- Subsequent pastes are faster (<2s)
- Copy→Paste workflow is optimized (<1s)
- Since the AI is run locally, performance can vary depending on your device

---





## Testing Guide

### 🔥 Quick Smoke Test (1 minute)

**Basic PII Protection:**
1. Paste into ChatGPT: `"Contact john@acme.com or call 555-123-4567"`
2. ✅ Should see: `"Contact [EMAIL_xxx] or call [PHONE_xxx]"`
3. Click into AI response, copy it
4. Paste into notepad/email
5. ✅ Original data restored automatically!

**Success!** ClipShield is working ✓

---

### 🎯 Feature Showcase (Optional - 5 minutes)

**Test 1: Multimodal Image Protection** (2 min)
1. Find any image with text/documents online
2. Copy image → Paste into ChatGPT/Claude
3. ✅ If sensitive content detected: Warning modal appears
4. Choose "Cancel" or "Share Anyway"

*Showcases: Prompt API multimodal mode*

**Test 2: Custom Pattern Learning** (2 min)  
1. Click extension icon → Settings
2. Custom Patterns → "+ Add Custom Pattern"
3. Name: "Project Codes"
4. Mode: "Smart Examples (AI)"
5. Add examples (one per line):
   ```
   PROJECT-2024-A1
   PROJECT-2024-B2
   ```
6. Save → Refresh ChatGPT page
7. Test paste: `"Working on PROJECT-2025-C3"`
8. ✅ Should detect as custom pattern (AI learned the format!)

*Showcases: Dynamic AI prompts, pattern teaching*

**Test 3: Granular Control** (1 min)
1. Extension Settings → Protected Information Types
2. Uncheck "Email Addresses"
3. Save → Refresh page
4. Paste: `"Email test@example.com"`
5. ✅ Email NOT protected (user has full control)

*Showcases: User agency, flexibility*

## Support
Issues? Suggestions? Feedback? Email: hello@guidekit.ai
