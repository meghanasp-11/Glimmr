import { Router, type IRouter } from "express";
import {
  defaultPreferences,
  getPreferences,
  setPreferences,
} from "../lib/preferencesStore";

const router: IRouter = Router();

interface UserProfile {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
}

const userStore = new Map<string, UserProfile>();

// GET /users/profile/:uid
router.get("/profile/:uid", (req, res) => {
  const { uid } = req.params;
  const profile = userStore.get(uid);
  if (!profile) {
    res.status(404).json({ error: "User profile not found" });
    return;
  }
  res.json(profile);
});

// PUT /users/profile/:uid
router.put("/profile/:uid", (req, res) => {
  const { uid } = req.params;
  const { displayName, email, photoURL } = req.body;
  if (!uid) {
    res.status(400).json({ error: "uid is required" });
    return;
  }
  const existing = userStore.get(uid);
  const updated: UserProfile = {
    id: existing?.id ?? uid,
    uid,
    displayName: displayName ?? existing?.displayName ?? "",
    email: email ?? existing?.email ?? "",
    photoURL,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  userStore.set(uid, updated);
  res.json(updated);
});

// GET /users/preferences/:uid
router.get("/preferences/:uid", async (req, res) => {
  const { uid } = req.params;
  const existing = await getPreferences(uid);
  if (!existing) {
    const defaults = defaultPreferences(uid);
    await setPreferences(defaults);
    res.json(defaults);
    return;
  }
  res.json(existing);
});

// PUT /api/users/preferences/:uid
router.put("/preferences/:uid", async (req, res) => {
  const { uid } = req.params;
  const existing = await getPreferences(uid);
  if (!existing) {
    res.status(404).json({ error: "Preferences not found" });
    return;
  }
  const allowed = ["defaultTransport", "defaultBudget", "defaultTime", "dietaryRestrictions", "accessibilityNeeds", "favoriteCategories", "notificationsEnabled", "emailUpdates"];
  const updated = { ...existing };
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      (updated as Record<string, unknown>)[field] = req.body[field];
    }
  }
  updated.updatedAt = new Date().toISOString();
  await setPreferences(updated);
  res.json(updated);
});

export default router;
