import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "../src/components/ProtectedRoute";
import OnboardingGuard from "../src/components/OnboardingGuard";
import OnboardingWizard from "../src/pages/admin/OnboardingWizard";
import React from "react";

// Mock localStorage
const localStorageMock = (
  function () {
    let store: { [key: string]: string } = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  }()
);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

const MockAdminDashboard = () => <div>Admin Dashboard Content</div>;

describe("Admin Onboarding Flow", () => {
  const authToken = "fake-auth-token";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // Test 1: Non-onboarded admin sees onboarding wizard
  it("should show onboarding wizard for non-onboarded admin", async () => {
    localStorage.setItem("auth_token", authToken);
    vi.spyOn(window, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ isOnboarded: false }),
    } as Response);

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin/*" element={<ProtectedRoute><OnboardingGuard><MockAdminDashboard /></OnboardingGuard></ProtectedRoute>} />
          <Route path="/admin/onboarding" element={<ProtectedRoute><OnboardingWizard /></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Salon Kurulum Sihirbazı/i)).toBeDefined();
      expect(screen.getByLabelText(/Salon Adı:/i)).toBeDefined();
    });
  });



  // Test 3: Onboarded admin skips onboarding and goes to dashboard
  it("should go to admin dashboard directly if already onboarded", async () => {
    localStorage.setItem("auth_token", authToken);
    vi.spyOn(window, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ isOnboarded: true }),
    } as Response);

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin/*" element={<ProtectedRoute><OnboardingGuard><MockAdminDashboard /></OnboardingGuard></ProtectedRoute>} />
          <Route path="/admin/onboarding" element={<ProtectedRoute><OnboardingWizard /></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Admin Dashboard Content/i)).toBeDefined();
      expect(screen.queryByText(/Salon Kurulum Sihirbazı/i)).toBeNull();
    });
  });
});