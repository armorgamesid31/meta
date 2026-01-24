import { describe, it, expect, beforeEach, vi, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AdminLayout from "../src/components/AdminLayout";
import ProtectedRoute from "../src/components/ProtectedRoute";
import OnboardingWizard from "../src/pages/admin/OnboardingWizard";
import React from "react";
import { prisma } from "../src/prisma";

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
    vi.spyOn(window, "fetch").mockResolvedValue({ // Mock fetch for API calls
      ok: true,
      json: async () => ({}), // Default empty response
    } as Response);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Test 1: Non-onboarded salon sees onboarding wizard
  it("should show onboarding wizard for non-onboarded salon", async () => {
    localStorage.setItem("auth_token", authToken);
    localStorage.setItem("salon_onboarded", "false"); // Explicitly set as non-onboarded

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute>
                <OnboardingWizard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Salon Bilgileri/i)).toBeDefined();
    });
  });

  // Test 2: Onboarded salon skips wizard and sees dashboard
  it("should skip onboarding wizard for onboarded salon and show dashboard", async () => {
    localStorage.setItem("auth_token", authToken);
    localStorage.setItem("salon_onboarded", "true"); // Explicitly set as onboarded

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <MockAdminDashboard />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Admin Dashboard Content/i)).toBeDefined();
    });
  });

  // Test 3: Salon Info step navigation and API call
  it("should navigate through Salon Info step and call API", async () => {
    localStorage.setItem("auth_token", authToken);
    localStorage.setItem("salon_onboarded", "false");

    const mockFetch = vi.spyOn(window, "fetch");
    mockFetch.mockResolvedValueOnce({ // Mock response for salon info save
      ok: true,
      json: async () => ({ message: "Salon info saved", salonId: 1 }),
    } as Response);

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute>
                <OnboardingWizard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    // Step 1: Salon Info
    await waitFor(() => expect(screen.getByText(/Salon Bilgileri/i)).toBeDefined());
    fireEvent.change(screen.getByLabelText(/Salon Adı:/i), { target: { value: "My New Salon" } });
    fireEvent.change(screen.getByLabelText(/Salon Slug:/i), { target: { value: "my-new-salon" } });
    fireEvent.click(screen.getByText(/İleri/i));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/salon/setup-info",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ name: "My New Salon", slug: "my-new-salon" }),
        })
      );
      expect(screen.getByText(/Çalışma Saatleri/i)).toBeDefined();
    });
  });
});
