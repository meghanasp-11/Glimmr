# Firebase Setup Guide for Glimmr

This guide will help you set up Firebase for the Glimmr project.

## 🔥 Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"** or select an existing project
3. Enter project name: `Glimmr` (or your preferred name)
4. (Optional) Enable Google Analytics
5. Click **"Create project"**

---

## 📱 Step 2: Register Your Web App

1. In Firebase Console, click the **Web icon** (`</>`) to add a web app
2. Enter app nickname: `Glimmr Web App`
3. **Check** "Also set up Firebase Hosting" (optional)
4. Click **"Register app"**
5. Copy the `firebaseConfig` object - you'll need these values

---

## 🔑 Step 3: Set Up Environment Variables

1. In your project, create `.env` file in `artifacts/glimmr/`:
   ```bash
   cp artifacts/glimmr/.env.example artifacts/glimmr/.env
   ```

2. Open `.env` and fill in your Firebase config values:
   ```env
   VITE_FIREBASE_API_KEY=your_restricted_firebase_web_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
   VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
   VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
   ```

3. **Important**: `.env` is already ignored. Do not put server secrets or service-account credentials in `VITE_*` variables: those values are visible in the browser bundle.

---

## 🗄️ Step 4: Enable Firestore Database

1. In Firebase Console, go to **"Firestore Database"**
2. Click **"Create database"**
3. Choose **"Start in production mode"** and deploy this repository's `firestore.rules` before using the app.
4. Select a location (choose closest to your users)
5. Click **"Enable"**

Do not use an open or time-limited development rule with a deployed project.

### Production Security Rules (update before launch):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Places collection - read-only for all users
    match /places/{placeId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.token.admin == true;
    }
    
    // Outings collection - users can only access their own outings
    match /outings/{outingId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null;
    }
  }
}
```

---

## 📦 Step 5: Enable Firebase Storage

1. In Firebase Console, go to **"Storage"**
2. Click **"Get started"**
3. Choose **"Start in production mode"** and deploy this repository's `storage.rules` before using the app.
4. Select the same location as Firestore
5. Click **"Done"**

Do not use an open or time-limited development rule with a deployed project.

### Production Storage Rules:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Place images - anyone can read, only admins can write
    match /places/images/{imageId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.token.admin == true;
    }
    
    // User uploads - authenticated users only
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 🔐 Step 6: (Optional) Enable Authentication

If you plan to add user accounts:

1. Go to **"Authentication"** in Firebase Console
2. Click **"Get started"**
3. Enable sign-in methods:
   - **Email/Password**
   - **Google** (recommended)
   - Others as needed
4. No additional environment variables needed

---

## 📁 Project Structure

After setup, your Firebase integration files:

```
artifacts/glimmr/
├── .env                          # Your Firebase config (DO NOT COMMIT)
├── .env.example                  # Template for .env
└── src/
    ├── lib/
    │   └── firebase.ts           # Firebase initialization
    └── services/
        ├── firebaseStorage.ts    # Storage helpers
        └── firebaseService.ts    # Firestore CRUD operations
```

---

## 🧪 Step 7: Test the Connection

Run your app and check the browser console for Firebase initialization:

```bash
pnpm --filter @glimmr/app run dev
```

You should see no errors related to Firebase. If there are issues, verify:
- ✅ `.env` file exists in `artifacts/glimmr/`
- ✅ All environment variables are set correctly
- ✅ Firestore and Storage are enabled in Firebase Console

---

## 📊 Firestore Collections Structure

### `places` Collection:
```typescript
{
  id: string;
  name: string;
  type: string;
  area: string;
  description: string;
  duration: number;
  cost: number;
  imageUrl?: string;
  rating?: number;
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `outings` Collection:
```typescript
{
  id: string;
  userId?: string;
  planName: string;
  places: Array<PlaceStop>;
  totalCost: number;
  totalDuration: number;
  status: 'planned' | 'in_progress' | 'completed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 🚀 Usage Examples

### Upload an image:
```typescript
import { uploadFile } from '@/services/firebaseStorage';

const handleImageUpload = async (file: File) => {
  const url = await uploadFile(file, `places/images/${file.name}`);
  console.log('Image uploaded:', url);
};
```

### Save a place:
```typescript
import { savePlace } from '@/services/firebaseService';

const newPlace = {
  name: 'Cubbon Park',
  type: 'park',
  area: 'Indiranagar',
  duration: 120,
  cost: 0,
};

const placeId = await savePlace(newPlace);
```

### Query places:
```typescript
import { getPlacesByArea } from '@/services/firebaseService';

const places = await getPlacesByArea('Indiranagar');
```

---

## 🔒 Security Checklist

Before going to production:

- [ ] Update Firestore security rules
- [ ] Update Storage security rules
- [ ] Enable App Check (prevents API abuse)
- [ ] Set up billing alerts
- [ ] Review Firebase usage quotas
- [ ] Enable Authentication if needed
- [ ] Add indexes for complex queries

---

## 📚 Resources

- [Firebase Docs](https://firebase.google.com/docs)
- [Firestore Docs](https://firebase.google.com/docs/firestore)
- [Firebase Storage Docs](https://firebase.google.com/docs/storage)
- [Security Rules Guide](https://firebase.google.com/docs/rules)

---

## 🐛 Troubleshooting

### Error: "Firebase: Error (auth/api-key-not-valid)"
- Check that `VITE_FIREBASE_API_KEY` is correct in `.env`

### Error: "Missing or insufficient permissions"
- Update Firestore security rules to allow read/write access

### Error: "Network request failed"
- Check internet connection
- Verify Firebase project is active
- Check browser console for CORS issues

---

Happy coding! 🎉
