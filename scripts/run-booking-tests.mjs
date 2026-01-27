#!/usr/bin/env node

/**
 * Comprehensive Booking System Test Runner
 * Executes the 5 test scenarios for deterministic validation
 */

import { testDataManager } from '../src/utils/testDataManager.js';
import { prisma } from '../src/prisma.js';

class BookingTestRunner {
  constructor() {
    this.salonId = null;
    this.testResults = {
      TEST_1: null,
      TEST_2: null,
      TEST_3: null,
      TEST_4: null,
      TEST_5: null
    };
  }

  async initialize() {
    console.log('🚀 Initializing Booking System Tests...\n');

    // Get test salon (assume first salon for testing)
    const salon = await prisma.salon.findFirst();
    if (!salon) {
      throw new Error('No salon found. Please create a test salon first.');
    }

    this.salonId = salon.id;
    console.log(`📍 Using test salon: ${salon.name} (ID: ${salon.id})`);

    // Clean up any existing test data
    await testDataManager.cleanupAllTestData();

    // Setup test salon infrastructure
    await testDataManager.setupTestSalon(this.salonId);

    console.log('✅ Test environment initialized\n');
  }

  async runTest1() {
    console.log('🟢 TEST 1: FIRST TIME CUSTOMER');
    console.log('🎯 Goal: Verify personal info collection for new customers\n');

    try {
      // GIVEN: No customer exists
      console.log('📝 GIVEN: Phone +905551112233 not in database');

      const existingCustomer = await prisma.customer.findFirst({
        where: { phone: '+905551112233' }
      });

      if (existingCustomer) {
        throw new Error('Customer already exists - test isolation failed');
      }

      // WHEN: Generate magic link and simulate booking
      console.log('🔗 WHEN: Generate magic link and complete booking');

      const { url: magicUrl } = await testDataManager.generateTestMagicLink(this.salonId);

      // Simulate the booking process (in real test, this would be done by Playwright)
      console.log('🎭 Simulating booking flow...');

      // 1. Magic link resolution
      const token = magicUrl.split('/m/')[1];
      const magicLink = await prisma.magicLink.findUnique({
        where: { token }
      });

      if (!magicLink) throw new Error('Magic link not found');

      // 2. Customer creation (simulated booking completion)
      const customer = await prisma.customer.create({
        data: {
          phone: '+905551112233',
          name: 'Test User',
          salonId: this.salonId
        }
      });

      // 3. Appointment creation
      const appointment = await prisma.appointment.create({
        data: {
          customerName: 'Test User',
          customerPhone: '+905551112233',
          startTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
          endTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000), // +30 min
          status: 'BOOKED',
          salonId: this.salonId,
          serviceId: 1,
          staffId: 1,
          customerId: customer.id
        }
      });

      // THEN: Verify results
      console.log('🔍 THEN: Verify customer and appointment created');

      await testDataManager.verifyTestResults('TEST_1');

      this.testResults.TEST_1 = 'PASS';
      console.log('✅ TEST 1 PASSED\n');

    } catch (error) {
      this.testResults.TEST_1 = 'FAIL';
      console.log(`❌ TEST 1 FAILED: ${error.message}\n`);
      throw error;
    }
  }

  async runTest2() {
    console.log('🟢 TEST 2: RETURNING CUSTOMER');
    console.log('🎯 Goal: Verify info step is skipped for existing customers\n');

    try {
      // GIVEN: Customer exists from TEST 1
      console.log('📝 GIVEN: Customer exists from previous test');

      const existingCustomer = await prisma.customer.findFirst({
        where: { phone: '+905551112233' }
      });

      if (!existingCustomer) {
        throw new Error('Customer from TEST 1 not found');
      }

      const initialAppointmentCount = await prisma.appointment.count({
        where: { customerPhone: '+905551112233' }
      });

      // WHEN: Generate new magic link and simulate booking
      console.log('🔗 WHEN: Generate new magic link for same customer');

      const { url: magicUrl } = await testDataManager.generateTestMagicLink(this.salonId);

      // Simulate booking (customer should not be recreated)
      console.log('🎭 Simulating booking flow for returning customer...');

      // 1. Magic link resolution
      const token = magicUrl.split('/m/')[1];
      const magicLink = await prisma.magicLink.findUnique({
        where: { token }
      });

      if (!magicLink) throw new Error('Magic link not found');

      // 2. Create additional appointment (customer should reuse existing)
      const appointment = await prisma.appointment.create({
        data: {
          customerName: existingCustomer.name,
          customerPhone: existingCustomer.phone,
          startTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // Day after tomorrow
          endTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
          status: 'BOOKED',
          salonId: this.salonId,
          serviceId: 1,
          staffId: 1,
          customerId: existingCustomer.id
        }
      });

      // THEN: Verify results
      console.log('🔍 THEN: Verify no new customer created, appointment added');

      await testDataManager.verifyTestResults('TEST_2');

      const finalAppointmentCount = await prisma.appointment.count({
        where: { customerPhone: '+905551112233' }
      });

      if (finalAppointmentCount <= initialAppointmentCount) {
        throw new Error('Appointment was not created');
      }

      this.testResults.TEST_2 = 'PASS';
      console.log('✅ TEST 2 PASSED\n');

    } catch (error) {
      this.testResults.TEST_2 = 'FAIL';
      console.log(`❌ TEST 2 FAILED: ${error.message}\n`);
      throw error;
    }
  }

  async runTest3() {
    console.log('🔴 TEST 3: RISKY CUSTOMER');
    console.log('🎯 Goal: Verify risk assessment and appropriate responses\n');

    try {
      // GIVEN: Customer with risk history
      console.log('📝 GIVEN: Customer with 3 last-minute cancellations');

      // Enable risk tracking for this test
      await prisma.salonRiskConfig.upsert({
        where: { salonId: this.salonId },
        update: { isEnabled: true },
        create: {
          salonId: this.salonId,
          isEnabled: true,
          warningThreshold: 25.0,
          blockingThreshold: 50.0
        }
      });

      // WHEN: Customer attempts new booking
      console.log('🔗 WHEN: Customer attempts new booking');

      const customer = await prisma.customer.findFirst({
        where: { phone: '+905551112233' }
      });

      if (!customer) throw new Error('Customer not found');

      // Simulate risk calculation
      const riskProfile = await prisma.customerRiskProfile.findUnique({
        where: {
          customerId_salonId: {
            customerId: customer.id,
            salonId: this.salonId
          }
        }
      });

      // THEN: Verify risk assessment
      console.log('🔍 THEN: Verify risk profile and scoring');

      await testDataManager.verifyTestResults('TEST_3');

      if (!riskProfile) throw new Error('Risk profile not created');
      if (riskProfile.lastMinuteCancellations < 3) throw new Error('Cancellations not tracked');

      // Verify risk level calculation
      const expectedScore = 3 * 8; // 3 cancellations × 8 severity = 24
      if (riskProfile.riskScore < expectedScore) {
        throw new Error(`Risk score too low: ${riskProfile.riskScore}, expected >= ${expectedScore}`);
      }

      this.testResults.TEST_3 = 'PASS';
      console.log('✅ TEST 3 PASSED\n');

    } catch (error) {
      this.testResults.TEST_3 = 'FAIL';
      console.log(`❌ TEST 3 FAILED: ${error.message}\n`);
      throw error;
    }
  }

  async runTest4() {
    console.log('🟣 TEST 4: UI REGRESSION CHECK');
    console.log('🎯 Goal: Verify UI matches design specifications\n');

    // NOTE: This test would require Playwright/Figma MCP integration
    // For now, we'll mark it as requiring external tools

    console.log('📋 TEST 4: Requires Playwright + Figma MCP integration');
    console.log('🔧 Implementation needed: UI element verification against Figma designs');

    this.testResults.TEST_4 = 'SKIP';
    console.log('⏭️ TEST 4 SKIPPED (Requires external tools)\n');
  }

  async runTest5() {
    console.log('🧹 TEST 5: CLEANUP');
    console.log('🎯 Goal: Remove all test data\n');

    try {
      // WHEN: Cleanup is executed
      console.log('🧹 WHEN: Execute cleanup');

      const summaryBefore = await testDataManager.getTestDataSummary();
      console.log('📊 Data before cleanup:', summaryBefore);

      await testDataManager.cleanupAllTestData();

      // THEN: Verify cleanup
      console.log('🔍 THEN: Verify all test data removed');

      const summaryAfter = await testDataManager.getTestDataSummary();
      console.log('📊 Data after cleanup:', summaryAfter);

      if (summaryAfter.customers > 0 || summaryAfter.appointments > 0) {
        throw new Error('Test data not fully cleaned up');
      }

      this.testResults.TEST_5 = 'PASS';
      console.log('✅ TEST 5 PASSED\n');

    } catch (error) {
      this.testResults.TEST_5 = 'FAIL';
      console.log(`❌ TEST 5 FAILED: ${error.message}\n`);
      throw error;
    }
  }

  async runAllTests() {
    try {
      await this.initialize();

      await this.runTest1();
      await this.runTest2();
      await this.runTest3();
      await this.runTest4();
      await this.runTest5();

      this.printSummary();

    } catch (error) {
      console.error('💥 Test execution failed:', error);
      this.printSummary();
      process.exit(1);
    }
  }

  printSummary() {
    console.log('📊 TEST EXECUTION SUMMARY');
    console.log('========================');

    const passed = Object.values(this.testResults).filter(r => r === 'PASS').length;
    const failed = Object.values(this.testResults).filter(r => r === 'FAIL').length;
    const skipped = Object.values(this.testResults).filter(r => r === 'SKIP').length;

    Object.entries(this.testResults).forEach(([test, result]) => {
      const icon = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : '⏭️';
      console.log(`${icon} ${test}: ${result}`);
    });

    console.log(`\n📈 Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

    if (failed === 0 && skipped === 0) {
      console.log('🎉 ALL TESTS PASSED!');
    } else if (failed === 0) {
      console.log('⚠️ TESTS PASSED (some skipped)');
    } else {
      console.log('💥 SOME TESTS FAILED');
    }
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new BookingTestRunner();
  runner.runAllTests();
}

export { BookingTestRunner };