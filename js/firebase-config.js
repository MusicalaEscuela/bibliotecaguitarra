/**
 * ============================================================================
 * FIREBASE CONFIG
 * Biblioteca de Guitarra - Musicala
 * ----------------------------------------------------------------------------
 * Configuración robusta para frontend puro (GitHub Pages + ES Modules)
 * ============================================================================
 */

import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  initializeFirestore,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * ============================================================================
 * CONFIG REAL
 * ============================================================================
 */
const firebaseConfig = {
  apiKey: "AIzaSyD8p1Ges94PMBPE-wuFVjeE5uGzeUQYBS0",
  authDomain: "biblioteca-guitarra-fa182.firebaseapp.com",
  projectId: "biblioteca-guitarra-fa182",
  storageBucket: "biblioteca-guitarra-fa182.firebasestorage.app",
  messagingSenderId: "803045423554",
  appId: "1:803045423554:web:15ca1900bc6c5283f07e5b",
};

/**
 * ============================================================================
 * VALIDACIÓN
 * ============================================================================
 */
const REQUIRED_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
];

const missingKeys = REQUIRED_KEYS.filter((key) => {
  const value = firebaseConfig[key];
  return typeof value !== "string" || value.trim() === "";
});

if (missingKeys.length > 0) {
  throw new Error(
    `[Firebase] Config incompleta. Faltan: ${missingKeys.join(", ")}`
  );
}

console.log("[Firebase] Inicializando app...", {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  host: window.location.hostname,
  origin: window.location.origin,
});

/**
 * ============================================================================
 * APP
 * ============================================================================
 */
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * ============================================================================
 * AUTH
 * ============================================================================
 */
const auth = getAuth(app);

/**
 * ============================================================================
 * FIRESTORE
 * ----------------------------------------------------------------------------
 * Esta config ayuda a evitar falsos estados offline en web/local.
 * ============================================================================
 */
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
});

/**
 * ============================================================================
 * PROVIDER GOOGLE
 * ============================================================================
 */
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
});

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */
export {
  app,
  auth,
  db,
  googleProvider,
};