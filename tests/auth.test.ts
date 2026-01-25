import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import app from "../src/server"; // Ensure your Express app is exported from src/server.ts
import { prisma } from "../src/prisma";
import bcrypt from "bcrypt";
import { generateToken } from "../src/utils/jwt";
import { UserRole } from "@prisma/client";

// Ensure environment variables are loaded for tests
import dotenv from "dotenv";
dotenv.config();

const TEST_USER_EMAIL_REGISTER = "register@example.com";
const TEST_USER_EMAIL_LOGIN_VALID = "loginvalid@example.com";
const TEST_USER_EMAIL_LOGIN_INVALID = "logininvalid@example.com";
const TEST_USER_EMAIL_AUTH_ME = "authme@example.com";

const TEST_USER_PASSWORD = "testpassword";
const TEST_SALON_NAME = "Test Salon";
const TEST_SALON_NAME_LOGIN = "Login Test Salon";
const TEST_SALON_NAME_LOGIN_INVALID = "Login Invalid Test Salon";
const TEST_SALON_NAME_AUTH_ME = "Authenticated Test Salon";

let setupSalonId: number; // For the salon created in beforeAll for /auth/me
let setupUserId: number;
let setupUserToken: string;

describe("Auth Integration Tests", () => {
  beforeAll(async () => {
    // Clean up any existing test data that might interfere with tests
    await prisma.salonUser.deleteMany({ where: { email: TEST_USER_EMAIL_REGISTER } });
    await prisma.salonUser.deleteMany({ where: { email: TEST_USER_EMAIL_LOGIN_VALID } });
    await prisma.salonUser.deleteMany({ where: { email: TEST_USER_EMAIL_LOGIN_INVALID } });
    await prisma.salonUser.deleteMany({ where: { email: TEST_USER_EMAIL_AUTH_ME } });
    
    await prisma.salon.deleteMany({ where: { name: TEST_SALON_NAME } });
    await prisma.salon.deleteMany({ where: { name: TEST_SALON_NAME_LOGIN } });
    await prisma.salon.deleteMany({ where: { name: TEST_SALON_NAME_LOGIN_INVALID } });
    await prisma.salon.deleteMany({ where: { name: TEST_SALON_NAME_AUTH_ME } });

    // Create a salon and an OWNER user for tests that require authentication (e.g., /auth/me)
    const salon = await prisma.salon.create({
      data: {
        name: TEST_SALON_NAME_AUTH_ME,
        users: {
          create: {
            email: TEST_USER_EMAIL_AUTH_ME,
            passwordHash: await bcrypt.hash("authpassword", 10),
            role: UserRole.OWNER,
          },
        },
      },
      include: {
        users: true,
      },
    });
    setupSalonId = salon.id;
    setupUserId = salon.users[0].id;
    setupUserToken = generateToken({
      userId: setupUserId,
      salonId: setupSalonId,
      role: UserRole.OWNER,
    });
  }, 30000); // Increase timeout to 30 seconds

  afterAll(async () => {
    // Clean up test data after all tests are done
    await prisma.salonUser.deleteMany({ where: { email: TEST_USER_EMAIL_REGISTER } });
    await prisma.salonUser.deleteMany({ where: { email: TEST_USER_EMAIL_LOGIN_VALID } });
    await prisma.salonUser.deleteMany({ where: { email: TEST_USER_EMAIL_LOGIN_INVALID } });
    await prisma.salonUser.deleteMany({ where: { email: TEST_USER_EMAIL_AUTH_ME } });

    await prisma.salon.deleteMany({ where: { name: TEST_SALON_NAME } });
    await prisma.salon.deleteMany({ where: { name: TEST_SALON_NAME_LOGIN } });
    await prisma.salon.deleteMany({ where: { name: TEST_SALON_NAME_LOGIN_INVALID } });
    await prisma.salon.deleteMany({ where: { name: TEST_SALON_NAME_AUTH_ME } });
    
    await prisma.$disconnect();
  });

  it("POST /auth/register should create a new OWNER user and salon and return a JWT token", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({
        email: TEST_USER_EMAIL_REGISTER,
        password: TEST_USER_PASSWORD,
        salonName: TEST_SALON_NAME,
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user.email).toEqual(TEST_USER_EMAIL_REGISTER);
    expect(res.body.user.role).toEqual(UserRole.OWNER);

    const salonInDb = await prisma.salon.findUnique({ where: { id: (res.body.user.salonId as number) } });
    expect(salonInDb).not.toBeNull();
    expect(salonInDb?.name).toEqual(TEST_SALON_NAME);
  });

  it("POST /auth/login should return a JWT token for valid credentials", async () => {
    // Ensure the user exists before attempting to log in for this specific test
    await prisma.salon.create({
      data: {
        name: TEST_SALON_NAME_LOGIN,
        users: {
          create: {
            email: TEST_USER_EMAIL_LOGIN_VALID,
            passwordHash: await bcrypt.hash(TEST_USER_PASSWORD, 10),
            role: UserRole.OWNER,
          },
        },
      },
    });

    const res = await request(app)
      .post("/auth/login")
      .send({
        email: TEST_USER_EMAIL_LOGIN_VALID,
        password: TEST_USER_PASSWORD,
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user.email).toEqual(TEST_USER_EMAIL_LOGIN_VALID);
  });

  it("POST /auth/login should return 401 for invalid credentials", async () => {
    // Ensure a user exists for this invalid login test
    await prisma.salon.create({
      data: {
        name: TEST_SALON_NAME_LOGIN_INVALID,
        users: {
          create: {
            email: TEST_USER_EMAIL_LOGIN_INVALID,
            passwordHash: await bcrypt.hash(TEST_USER_PASSWORD, 10),
            role: UserRole.OWNER,
          },
        },
      },
    });

    const res = await request(app)
      .post("/auth/login")
      .send({
        email: TEST_USER_EMAIL_LOGIN_INVALID,
        password: "wrongpassword",
      });
    expect(res.statusCode).toEqual(401);
  });

  it("GET /auth/me should return 401 without token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.statusCode).toEqual(401);
  });

  it("GET /auth/me should return user data with valid token", async () => {
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${setupUserToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("user");
    expect(res.body.user.id).toEqual(setupUserId);
    expect(res.body.user.salonId).toEqual(setupSalonId);
    expect(res.body.user.role).toEqual(UserRole.OWNER);
  });
});
