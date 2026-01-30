#!/usr/bin/env node

/**
 * End-to-End test for Magic Link Booking functionality
 * Tests the complete user flow using Playwright
 */

import { use_mcp_tool } from './mcp-client.js';

// Test URLs
const FRONTEND_URL = 'http://localhost:5175';
const MAGIC_LINK_URL = `${FRONTEND_URL}/magic-link?token=test123&salonId=1&datetime=2026-01-30T10:00:00Z&people=[{"name":"Test User","birthDate":"1990-01-01","gender":"female","services":[{"serviceId":1,"staffId":1}]}]`;

// Mock magic link data
const mockMagicLink = {
  token: 'test123',
  phone: '+905551234567',
  type: 'BOOKING',
  context: {
    salonId: 1,
    appointmentId: null
  },
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
  usedAt: null
};

async function testMagicLinkFlow() {
  console.log('🧪 Testing Magic Link Booking E2E Flow...\n');

  try {
    // Step 1: Create a mock magic link in database
    console.log('📝 Step 1: Creating mock magic link...');
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const existingLink = await prisma.magicLink.findUnique({
      where: { token: mockMagicLink.token }
    });

    if (!existingLink) {
      await prisma.magicLink.create({
        data: mockMagicLink
      });
      console.log('✅ Mock magic link created');
    } else {
      console.log('ℹ️ Mock magic link already exists');
    }

    await prisma.$disconnect();

    // Step 2: Navigate to magic link page
    console.log('🌐 Step 2: Navigating to magic link page...');
    console.log(`URL: ${MAGIC_LINK_URL}`);

    const navigateResult = await use_mcp_tool({
      server_name: 'local-playwright',
      tool_name: 'playwright_navigate',
      arguments: {
        url: MAGIC_LINK_URL,
        headless: false
      }
    });

    if (navigateResult.error) {
      console.log('❌ Navigation failed:', navigateResult.error);
      return;
    }

    console.log('✅ Page navigation successful');

    // Step 3: Wait for page to load and check for errors
    console.log('⏳ Step 3: Waiting for page load...');

    // Wait a bit for the page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 4: Get page content to check if it loaded
    console.log('📄 Step 4: Checking page content...');

    const contentResult = await use_mcp_tool({
      server_name: 'local-playwright',
      tool_name: 'playwright_get_visible_text',
      arguments: {}
    });

    if (contentResult.error) {
      console.log('❌ Failed to get page content:', contentResult.error);
    } else {
      const visibleText = contentResult.result || '';
      console.log('📝 Visible text preview:', visibleText.substring(0, 200) + '...');

      // Check for expected content
      if (visibleText.includes('SalonAsistan') || visibleText.includes('Hoş Geldiniz')) {
        console.log('✅ Page loaded successfully - Turkish content detected');
      } else if (visibleText.includes('Welcome') || visibleText.includes('Merhaba')) {
        console.log('✅ Page loaded successfully - Welcome content detected');
      } else {
        console.log('⚠️ Page loaded but expected content not found');
        console.log('Full content:', visibleText);
      }
    }

    // Step 5: Check for JavaScript errors
    console.log('🐛 Step 5: Checking for JavaScript errors...');

    const consoleLogs = await use_mcp_tool({
      server_name: 'local-playwright',
      tool_name: 'playwright_get_console_logs',
      arguments: {}
    });

    if (consoleLogs.error) {
      console.log('❌ Failed to get console logs:', consoleLogs.error);
    } else {
      const logs = consoleLogs.result || [];
      const errors = logs.filter(log => log.type === 'error');

      if (errors.length > 0) {
        console.log('❌ JavaScript errors found:');
        errors.forEach(error => console.log(`  - ${error.text}`));
      } else {
        console.log('✅ No JavaScript errors detected');
      }
    }

    // Step 6: Check for network errors
    console.log('🌐 Step 6: Checking network activity...');

    const networkActivity = await use_mcp_tool({
      server_name: 'local-playwright',
      tool_name: 'playwright_get_network_activity',
      arguments: {}
    });

    if (networkActivity.error) {
      console.log('❌ Failed to get network activity:', networkActivity.error);
    } else {
      const requests = networkActivity.result || [];
      const failedRequests = requests.filter(req => req.status >= 400);

      if (failedRequests.length > 0) {
        console.log('❌ Network errors found:');
        failedRequests.forEach(req => console.log(`  - ${req.status} ${req.method} ${req.url}`));
      } else {
        console.log('✅ No network errors detected');
      }
    }

    // Step 7: Take a screenshot for visual verification
    console.log('📸 Step 7: Taking screenshot...');

    const screenshotResult = await use_mcp_tool({
      server_name: 'local-playwright',
      tool_name: 'playwright_screenshot',
      arguments: {
        name: 'magic-link-test',
        fullPage: true
      }
    });

    if (screenshotResult.error) {
      console.log('❌ Screenshot failed:', screenshotResult.error);
    } else {
      console.log('✅ Screenshot saved');
    }

    // Step 8: Test gender selection modal
    console.log('👥 Step 8: Testing gender selection modal...');

    // Look for gender selection buttons
    const pageHtml = await use_mcp_tool({
      server_name: 'local-playwright',
      tool_name: 'playwright_get_html',
      arguments: {}
    });

    if (pageHtml.error) {
      console.log('❌ Failed to get page HTML:', pageHtml.error);
    } else {
      const html = pageHtml.result || '';
      if (html.includes('Kadın Hizmetleri') || html.includes('Erkek Hizmetleri')) {
        console.log('✅ Gender selection modal detected');
      } else if (html.includes('Welcome') && (html.includes('Woman') || html.includes('Man'))) {
        console.log('✅ Gender selection modal detected (English)');
      } else {
        console.log('⚠️ Gender selection modal not found in HTML');
      }
    }

    // Step 9: Close browser
    console.log('🔚 Step 9: Closing browser...');
    await use_mcp_tool({
      server_name: 'local-playwright',
      tool_name: 'playwright_close',
      arguments: {}
    });

    console.log('\n🎉 Magic Link E2E Test completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testMagicLinkFlow();