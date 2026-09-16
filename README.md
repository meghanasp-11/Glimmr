# Glimmr

Glimmr is a local outing planner for Bengaluru. You tell it where you're going, how long you have, your budget, who's coming, and the kind of energy you're after — it gives you three distinct, editable outing plans.

## What it does

- Fill in a short form: starting area, destination, available time, budget per person, group size, transport mode, and mood
- Get three plan options, each a different shape of outing (best fit, best value, most adventurous)
- Open a plan and edit individual stops — swap a place, adjust timing, delete a stop, or add one
- Start an outing and track your stops as you go

V1 covers **Indiranagar, Bengaluru**.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Wouter, Framer Motion
- **Backend**: Express 5, Node.js (currently only a health check endpoint)
- **Database**: Firebase Firestore, with Firebase Authentication for per-user data access and Firebase Storage for files
- **Tooling**: npm workspaces, Orval (API codegen from OpenAPI spec), esbuild

## Project structure

```
artifacts/glimmr/       # React frontend
artifacts/api-server/   # Express API
lib/api-spec/           # OpenAPI spec + Orval config
lib/api-client-react/   # Generated React Query hooks
lib/api-zod/            # Generated Zod schemas
firestore.rules          # Firestore access controls
storage.rules            # Firebase Storage access controls
scripts/                # Workspace utility scripts
```

## Getting started

Install dependencies:

```bash
npm install
```

Run the frontend:

```bash
PORT=5173 BASE_PATH=/ npm run dev -w @glimmr/app
```

Run the API server:

```bash
npm run dev -w @glimmr/api-server
```

Type-check the entire workspace:

```bash
npm run typecheck
```

Build everything:

```bash
npm run build
```

## Environment variables

| Variable       | Required | Description                        |
|----------------|----------|------------------------------------|
| `PORT`         | No       | Port for frontend/API (default: 5173) |
| `BASE_PATH`    | No       | Vite base path (default: `/`)      |
| `CORS_ORIGIN`  | API only | Comma-separated browser-origin allowlist |
| `FIREBASE_PROJECT_ID` | API only | Firebase project for Firestore (Glimmr project: `glimmr-3b56a`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | API only | Absolute path to a service-account JSON key (outside the repo, never committed) |

## Key files

| File | Purpose |
|------|---------|
| `artifacts/glimmr/src/pages/` | Route components (home, planner, results, plan detail, outing) |
| `artifacts/glimmr/src/data/places.ts` | Place dataset for Indiranagar |
| `artifacts/glimmr/src/services/glimmrService.ts` | Service layer (mock data today, API later) |
| `artifacts/glimmr/src/lib/recommendationEngine.ts` | Plan scoring and generation algorithm |
| `artifacts/glimmr/src/types/glimmr.ts` | Shared domain types |
| `artifacts/glimmr/src/components/glimmr-ui.tsx` | Core product UI components |
| `artifacts/glimmr/src/index.css` | Design tokens, typography, layout |

## Notes

- When Firebase is configured, places, plans, and outings are read from and persisted to Firestore. The bundled places data is a local development fallback only.
- Plan edits recalculate cost, duration, travel time, distance, and feasibility in one place.
- The 3D landing visual (`route-three.tsx`) uses React Three Fiber with a plain SVG fallback for environments without WebGL.
- See [SECURITY.md](SECURITY.md) before deploying Firebase or the API.
