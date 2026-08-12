import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";

const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-hundred-rally";
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  projectId,
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    `https://${projectId}.firebaseio.com`,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789:web:demo",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export const usingEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS !== "false";

declare global {
  // eslint-disable-next-line no-var
  var __pixelRallyEmulatorsConnected: boolean | undefined;
}

if (usingEmulators && !globalThis.__pixelRallyEmulatorsConnected) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(database, "127.0.0.1", 9000);
  globalThis.__pixelRallyEmulatorsConnected = true;
}
