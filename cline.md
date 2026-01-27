# Salon Asistan – Cline Context

## Project Purpose
Salon Asistan is a booking system for beauty salons.
Goal: enable salon owners to create magic links and customers to book appointments without login.

This project is currently in LOCAL TESTING phase.

## Current State (VERY IMPORTANT)
- Backend: Node.js + Express + Prisma
- Frontend: React + Vite + TypeScript + Tailwind
- React.StrictMode intentionally removed
- MagicLinkBooking mounts ONCE and must NEVER unmount
- Slot-based booking flow implemented (no manual date/time input)

## Working Flows
- Salon registration via POST /auth/register-salon (LOCAL ONLY)
- Automatic login after registration
- Mandatory onboarding before panel access
- Admin panel works
- Magic link booking works end-to-end

## Known Issues Being Fixed
- Login endpoint mismatch:
  - Frontend calls POST /auth/login
  - Backend endpoint alignment in progress

## ABSOLUTE RULES
- Do NOT reintroduce component unmounting
- Do NOT add routing-based step changes
- Do NOT refactor unless explicitly requested
- Keep solutions minimal and local-only

## Current Goal
Align frontend login with backend login so existing salons can log in.

## User Profile
- Non-technical founder
- Needs step-by-step, simple explanations
- Local testing before mobile app
