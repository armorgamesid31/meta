import { prisma } from '../prisma.js';
import { logCustomerBehavior, BehaviorType } from './behaviorTracking.js';

/**
 * Test data management utilities for isolated, deterministic testing
 */
export class TestDataManager {
  private testPrefix = 'TEST_';
  private testPhone = '+905551112233';

  /**
   * Clean up all test data
   */
  async cleanupAllTestData() {
    try {
      console.log('🧹 Cleaning up test data...');

      // Delete in correct order (respecting foreign keys)
      await prisma.customerBehaviorLog.deleteMany({
        where: {
          customer: {
            phone: {
              startsWith: this.testPrefix
            }
          }
        }
      });

      await prisma.customerRiskProfile.deleteMany({
        where: {
          customer: {
            phone: {
              startsWith: this.testPrefix
            }
          }
        }
      });

      await prisma.appointment.deleteMany({
        where: {
          OR: [
            { customerPhone: { startsWith: this.testPrefix } },
            { customerPhone: this.testPhone }
          ]
        }
      });

      await prisma.customer.deleteMany({
        where: {
          OR: [
            { phone: { startsWith: this.testPrefix } },
            { phone: this.testPhone }
          ]
        }
      });

      await prisma.magicLink.deleteMany({
        where: {
          phone: {
            startsWith: this.testPrefix
          }
        }
      });

      console.log('✅ Test data cleanup completed');
    } catch (error) {
      console.error('❌ Error cleaning up test data:', error);
      throw error;
    }
  }

  /**
   * Setup test salon with services and staff
   */
  async setupTestSalon(salonId: number) {
    try {
      console.log('🏗️ Setting up test salon...');

      // Ensure salon has services
      const existingServices = await prisma.service.count({
        where: { salonId }
      });

      if (existingServices === 0) {
        await prisma.service.createMany({
          data: [
            {
              salonId,
              name: 'Saç Kesimi',
              duration: 30,
              price: 50.0
            },
            {
              salonId,
              name: 'Sakal Traşı',
              duration: 20,
              price: 30.0
            }
          ]
        });
      }

      // Ensure salon has staff
      const existingStaff = await prisma.staff.count({
        where: { salonId }
      });

      if (existingStaff === 0) {
        await prisma.staff.createMany({
          data: [
            {
              salonId,
              name: 'Ayşe Yılmaz'
            },
            {
              salonId,
              name: 'Mehmet Kaya'
            }
          ]
        });
      }

      // Ensure salon has working hours
      const existingSettings = await prisma.salonSettings.findUnique({
        where: { salonId }
      });

      if (!existingSettings) {
        await prisma.salonSettings.create({
          data: {
            salonId,
            workStartHour: 9,
            workEndHour: 18,
            slotInterval: 30
          }
        });
      }

      console.log('✅ Test salon setup completed');
    } catch (error) {
      console.error('❌ Error setting up test salon:', error);
      throw error;
    }
  }

  /**
   * Create test customer for TEST 1 (first-time customer)
   */
  async createFirstTimeCustomer(salonId: number) {
    // Don't create - this test verifies customer doesn't exist
    console.log('📝 TEST 1: First-time customer - no pre-existing data');
  }

  /**
   * Create test customer for TEST 2 (returning customer)
   */
  async createReturningCustomer(salonId: number) {
    try {
      console.log('👤 Creating returning customer for TEST 2...');

      const customer = await prisma.customer.upsert({
        where: {
          phone: this.testPhone
        },
        update: {
          name: 'Test User'
        },
        create: {
          phone: this.testPhone,
          name: 'Test User',
          salonId
        }
      });

      console.log('✅ Returning customer created:', customer.id);
      return customer;
    } catch (error) {
      console.error('❌ Error creating returning customer:', error);
      throw error;
    }
  }

  /**
   * Create test customer with risk history for TEST 3
   */
  async createRiskyCustomer(salonId: number) {
    try {
      console.log('⚠️ Creating risky customer for TEST 3...');

      // Create customer
      const customer = await this.createReturningCustomer(salonId);

      // Create 3 last-minute cancellations in the last 3 months
      const now = new Date();
      const cancellations = [
        { daysAgo: 10, hoursBefore: 2 },  // 10 days ago, 2 hours before
        { daysAgo: 25, hoursBefore: 6 },  // 25 days ago, 6 hours before
        { daysAgo: 45, hoursBefore: 1 }   // 45 days ago, 1 hour before
      ];

      for (const cancellation of cancellations) {
        const appointmentDate = new Date(now);
        appointmentDate.setDate(appointmentDate.getDate() - cancellation.daysAgo);

        // Create appointment
        const appointment = await prisma.appointment.create({
          data: {
            customerName: customer.name,
            customerPhone: customer.phone,
            startTime: appointmentDate,
            endTime: new Date(appointmentDate.getTime() + 30 * 60 * 1000), // 30 minutes
            status: 'CANCELLED',
            salonId,
            serviceId: 1, // Assume service exists
            staffId: 1,   // Assume staff exists
            customerId: customer.id
          }
        });

        // Log last-minute cancellation
        await logCustomerBehavior({
          customerId: customer.id,
          salonId,
          appointmentId: appointment.id,
          behaviorType: BehaviorType.LAST_MINUTE_CANCELLATION,
          severityScore: 8, // High severity
          metadata: {
            hoursUntilAppointment: cancellation.hoursBefore,
            appointmentDateTime: appointmentDate
          }
        });
      }

      console.log('✅ Risky customer created with 3 last-minute cancellations');
      return customer;
    } catch (error) {
      console.error('❌ Error creating risky customer:', error);
      throw error;
    }
  }

  /**
   * Generate magic link for testing
   */
  async generateTestMagicLink(salonId: number, type: 'BOOKING' = 'BOOKING') {
    try {
      console.log('🔗 Generating test magic link...');

      const { randomBytes } = await import('crypto');
      const token = randomBytes(32).toString('hex');

      const magicLink = await prisma.magicLink.create({
        data: {
          token,
          phone: this.testPhone,
          type: type as any,
          context: {
            salonId
          },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        }
      });

      const magicUrl = `http://localhost:5173/m/${token}`;

      console.log('✅ Test magic link generated:', magicUrl);
      return { token, url: magicUrl, magicLink };
    } catch (error) {
      console.error('❌ Error generating test magic link:', error);
      throw error;
    }
  }

  /**
   * Verify test results
   */
  async verifyTestResults(testType: 'TEST_1' | 'TEST_2' | 'TEST_3') {
    try {
      console.log(`🔍 Verifying results for ${testType}...`);

      switch (testType) {
        case 'TEST_1': {
          // Verify customer was created
          const customer = await prisma.customer.findFirst({
            where: { phone: this.testPhone }
          });
          if (!customer) throw new Error('Customer was not created');

          // Verify appointment exists
          const appointments = await prisma.appointment.findMany({
            where: { customerPhone: this.testPhone }
          });
          if (appointments.length === 0) throw new Error('Appointment was not created');

          console.log('✅ TEST 1 verification passed');
          break;
        }

        case 'TEST_2': {
          // Verify no new customer was created (should reuse existing)
          const customers = await prisma.customer.findMany({
            where: { phone: this.testPhone }
          });
          if (customers.length !== 1) throw new Error('Multiple customers found');

          // Verify appointment count increased
          const appointments = await prisma.appointment.findMany({
            where: { customerPhone: this.testPhone }
          });
          if (appointments.length < 2) throw new Error('Appointment was not created');

          console.log('✅ TEST 2 verification passed');
          break;
        }

        case 'TEST_3': {
          // Verify risk profile was created/updated
          const customer = await prisma.customer.findFirst({
            where: { phone: this.testPhone }
          });
          if (!customer) throw new Error('Customer not found');

          const riskProfile = await prisma.customerRiskProfile.findUnique({
            where: {
              customerId_salonId: {
                customerId: customer.id,
                salonId: customer.salonId
              }
            }
          });

          if (!riskProfile) throw new Error('Risk profile was not created');
          if (riskProfile.lastMinuteCancellations < 3) throw new Error('Cancellations not properly tracked');

          console.log('✅ TEST 3 verification passed');
          break;
        }
      }
    } catch (error) {
      console.error(`❌ ${testType} verification failed:`, error);
      throw error;
    }
  }

  /**
   * Get test data summary
   */
  async getTestDataSummary() {
    try {
      const [
        customers,
        appointments,
        behaviorLogs,
        riskProfiles
      ] = await Promise.all([
        prisma.customer.count({ where: { phone: this.testPhone } }),
        prisma.appointment.count({ where: { customerPhone: this.testPhone } }),
        prisma.customerBehaviorLog.count({
          where: {
            customer: { phone: this.testPhone }
          }
        }),
        prisma.customerRiskProfile.count({
          where: {
            customer: { phone: this.testPhone }
          }
        })
      ]);

      return {
        customers,
        appointments,
        behaviorLogs,
        riskProfiles
      };
    } catch (error) {
      console.error('Error getting test data summary:', error);
      return null;
    }
  }
}

// Export singleton instance
export const testDataManager = new TestDataManager();