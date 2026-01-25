import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

interface AuthRequest extends Request {
  user?: {
    userId: number;
    salonId: number;
    role: 'OWNER' | 'STAFF';
  };
}

// Middleware to check if salon is onboarded
const checkOnboarding = async (req: AuthRequest, res: Response, next: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonSettings = await prisma.salonSettings.findUnique({
    where: { salonId: req.user.salonId },
  });

  // Assuming a field `isOnboarded` in SalonSettings or a similar mechanism
  // For now, we'll assume if settings exist, it's onboarded. We will add `isOnboarded` later.
  if (salonSettings) {
    return res.status(403).json({ message: 'Salon is already onboarded.' });
  }

  next();
};

// POST /api/salon/setup-info - Step 1: Save salon info
router.post("/setup-info", authenticateToken, async (req: AuthRequest, res) => {
  const { name } = req.body;

  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  if (!name) {
    return res.status(400).json({ message: "Salon name is required." });
  }

  try {
    const updatedSalon = await prisma.salon.update({
      where: { id: req.user.salonId },
      data: { name },
    });

    res.status(200).json({ message: "Salon info saved successfully.", salon: updatedSalon });
  } catch (error) {
    console.error("Error saving salon info:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// POST /api/salon/setup-working-hours - Step 2: Save working hours
router.post("/setup-working-hours", authenticateToken, async (req: AuthRequest, res) => {
  const { workStartHour, workEndHour, slotInterval } = req.body;

  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  if (typeof workStartHour !== "number" || typeof workEndHour !== "number" || typeof slotInterval !== "number") {
    return res.status(400).json({ message: "Invalid working hours data." });
  }

  try {
    const salonSettings = await prisma.salonSettings.upsert({
      where: { salonId: req.user.salonId },
      update: { workStartHour, workEndHour, slotInterval },
      create: {
        salonId: req.user.salonId,
        workStartHour,
        workEndHour,
        slotInterval,
      },
    });

    res.status(200).json({ message: "Working hours saved successfully.", settings: salonSettings });
  } catch (error) {
    console.error("Error saving working hours:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// POST /api/salon/setup-services - Step 3: Add services
router.post("/setup-services", authenticateToken, async (req: AuthRequest, res) => {
  const { services } = req.body; // Expecting an array of { name, duration, price }

  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  if (!Array.isArray(services)) {
    return res.status(400).json({ message: "Services must be an array." });
  }

  try {
    // Delete existing services for the salon to prevent duplicates or stale data
    await prisma.service.deleteMany({
      where: { salonId: req.user.salonId },
    });

    const createdServices = await prisma.service.createMany({
      data: services.map((service: any) => ({
        salonId: req.user!.salonId,
        name: service.name,
        duration: service.duration,
        price: service.price,
      })),
    });

    res.status(200).json({ message: "Services saved successfully.", count: createdServices.count });
  } catch (error) {
    console.error("Error saving services:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// POST /api/salon/setup-staff - Step 4: Add staff
router.post("/setup-staff", authenticateToken, async (req: AuthRequest, res) => {
  const { staff } = req.body; // Expecting an array of { name }

  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  if (!Array.isArray(staff)) {
    return res.status(400).json({ message: "Staff must be an array." });
  }

  try {
    // Delete existing staff for the salon (excluding the owner user if they are also a staff member)
    // For now, let's just delete existing staff not linked to a SalonUser or manually created
    // More complex logic would be needed if owner user is also a staff member.
    await prisma.staff.deleteMany({
      where: {
        salonId: req.user.salonId,
        userId: null // Only delete staff not linked to a SalonUser
      },
    });

    const createdStaff = await prisma.staff.createMany({
      data: staff.map((member: any) => ({
        salonId: req.user!.salonId,
        name: member.name,
      })),
    });

    res.status(200).json({ message: "Staff saved successfully.", count: createdStaff.count });
  } catch (error) {
    console.error("Error saving staff:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// POST /api/salon/complete-onboarding - Step 5: Mark salon as onboarded
router.post("/complete-onboarding", authenticateToken, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  try {
    // Onboarding completion is handled by the existence of settings
    // No additional field needed since we check for settings existence
    res.status(200).json({ message: "Onboarding completed successfully." });
  } catch (error) {
    console.error("Error completing onboarding:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

export default router;
