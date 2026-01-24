import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { act } from "react-dom/test-utils";
import AdminLayout from "../src/components/AdminLayout";
import ProtectedRoute from "../src/components/ProtectedRoute";
import LoginPage from "../src/pages/LoginPage";
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

describe("Frontend Admin Routing and Layout", () => {
  beforeEach(() => {
    localStorage.clear(); // Clear localStorage before each test
  });

  it("Accessing /admin without token redirects to /login", async () => {
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute>
                <AdminLayout>Admin Content</AdminLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    // Expect to be redirected to login page by checking for its content
    expect(screen.getByText(/Admin Login/i)).toBeDefined();
  });

  it("Accessing /admin with token renders AdminLayout", async () => {
    localStorage.setItem("auth_token", "fake-jwt-token");

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute>
                <AdminLayout>Admin Content</AdminLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    // Expect AdminLayout content and bottom navigation to be visible
    expect(screen.getByText(/Admin Content/i)).toBeDefined();
    expect(screen.getByText(/Dashboard/i)).toBeDefined();
    expect(screen.getByText(/Calendar/i)).toBeDefined();
    expect(screen.getByText(/Settings/i)).toBeDefined();
  });
});
