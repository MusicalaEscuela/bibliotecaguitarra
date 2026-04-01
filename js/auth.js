import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  auth,
  db,
  googleProvider,
} from "./firebase-config.js";

/**
 * ============================================================================
 * AUTH
 * Biblioteca de Guitarra - Musicala
 * ----------------------------------------------------------------------------
 * Maneja:
 * - login con Google
 * - cierre de sesión
 * - observador de autenticación
 * - validación de usuarios autorizados en Firestore
 * ============================================================================
 */

const AUTHORIZED_USERS_COLLECTION = "authorizedUsers";

/**
 * Normaliza un correo para usarlo de forma consistente
 * en Firestore y en validaciones internas.
 *
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Limpia texto simple.
 *
 * @param {unknown} value
 * @returns {string}
 */
function safeText(value) {
  return String(value ?? "").trim();
}

/**
 * Obtiene inicial a partir del nombre o correo.
 *
 * @param {string} value
 * @returns {string}
 */
function getInitial(value) {
  const clean = safeText(value);
  if (!clean) return "M";
  return clean.charAt(0).toUpperCase();
}

/**
 * Detecta si un error parece venir de Firestore offline
 * o de una conexión que no logró resolverse.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isFirestoreOfflineError(error) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code || "").toLowerCase()
      : "";

  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error || "").toLowerCase();

  return (
    code.includes("unavailable") ||
    code.includes("failed-precondition") ||
    message.includes("offline") ||
    message.includes("client is offline") ||
    message.includes("failed to get document") ||
    message.includes("network")
  );
}

/**
 * Convierte el usuario de Firebase en una estructura simple y estable.
 *
 * @param {import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").User | null} user
 * @returns {{
 *   uid: string,
 *   name: string,
 *   email: string,
 *   photoURL: string,
 *   initial: string,
 *   emailVerified: boolean
 * } | null}
 */
function mapFirebaseUser(user) {
  if (!user) return null;

  const email = normalizeEmail(user.email);
  const fallbackName = email ? email.split("@")[0] : "Usuario";
  const name = safeText(user.displayName) || fallbackName;

  return {
    uid: user.uid,
    name,
    email,
    photoURL: safeText(user.photoURL),
    initial: getInitial(name || email),
    emailVerified: Boolean(user.emailVerified),
  };
}

/**
 * Traduce errores de auth a mensajes más entendibles.
 *
 * @param {unknown} error
 * @returns {string}
 */
function getAuthErrorMessage(error) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/popup-closed-by-user":
      return "Se cerró la ventana de inicio de sesión antes de completar el ingreso.";

    case "auth/popup-blocked":
      return "El navegador bloqueó la ventana emergente. Permitan popups e intenten de nuevo.";

    case "auth/cancelled-popup-request":
      return "Ya había un intento de ingreso en proceso. Intenten otra vez.";

    case "auth/network-request-failed":
      return "No se pudo completar el inicio de sesión por un problema de red.";

    case "auth/unauthorized-domain":
      return "Este dominio no está autorizado en Firebase Authentication.";

    case "auth/operation-not-allowed":
      return "El proveedor de Google no está habilitado en Firebase Authentication.";

    case "auth/account-exists-with-different-credential":
      return "Ya existe una cuenta con ese correo usando otro método de acceso.";

    case "auth/internal-error":
      return "Firebase presentó un error interno al intentar iniciar sesión.";

    default:
      return "No fue posible iniciar sesión en este momento.";
  }
}

/**
 * Lee el documento del usuario autorizado en Firestore.
 * La estructura esperada es:
 * authorizedUsers/{correo}
 *
 * {
 *   active: true,
 *   name: "Nombre del estudiante"
 * }
 *
 * @param {string} email
 * @returns {Promise<{
 *   exists: boolean,
 *   active: boolean,
 *   data: Record<string, any> | null
 * }>}
 */
async function getAuthorizedUserRecord(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      exists: false,
      active: false,
      data: null,
    };
  }

  try {
    console.log("[Auth] Consultando usuario autorizado:", normalizedEmail);

    const ref = doc(db, AUTHORIZED_USERS_COLLECTION, normalizedEmail);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      console.warn(
        "[Auth] Usuario no encontrado en authorizedUsers:",
        normalizedEmail
      );

      return {
        exists: false,
        active: false,
        data: null,
      };
    }

    const data = snapshot.data() || {};

    console.log("[Auth] Usuario autorizado encontrado:", {
      email: normalizedEmail,
      active: data.active === true,
      name: safeText(data.name),
    });

    return {
      exists: true,
      active: data.active === true,
      data,
    };
  } catch (error) {
    console.error("[Auth] Error leyendo authorizedUsers:", error);

    if (isFirestoreOfflineError(error)) {
      throw new Error("FIRESTORE_OFFLINE");
    }

    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";

    if (
      code === "permission-denied" ||
      code === "firestore/permission-denied"
    ) {
      throw new Error("FIRESTORE_PERMISSION_DENIED");
    }

    throw error;
  }
}

/**
 * Revisa si un usuario autenticado está autorizado para entrar.
 *
 * @param {import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").User | null} user
 * @returns {Promise<{
 *   allowed: boolean,
 *   reason: string | null,
 *   profile: {
 *     uid: string,
 *     name: string,
 *     email: string,
 *     photoURL: string,
 *     initial: string,
 *     emailVerified: boolean,
 *     authorizedName: string,
 *     active: boolean
 *   } | null
 * }>}
 */
async function validateAuthorizedUser(user) {
  const mappedUser = mapFirebaseUser(user);

  if (!mappedUser) {
    return {
      allowed: false,
      reason: "NO_AUTH_USER",
      profile: null,
    };
  }

  if (!mappedUser.email) {
    return {
      allowed: false,
      reason: "EMAIL_NOT_AVAILABLE",
      profile: null,
    };
  }

  try {
    const authorizedRecord = await getAuthorizedUserRecord(mappedUser.email);

    if (!authorizedRecord.exists) {
      return {
        allowed: false,
        reason: "USER_NOT_FOUND",
        profile: null,
      };
    }

    if (!authorizedRecord.active) {
      return {
        allowed: false,
        reason: "USER_INACTIVE",
        profile: null,
      };
    }

    const authorizedName =
      safeText(authorizedRecord.data?.name) || mappedUser.name;

    return {
      allowed: true,
      reason: null,
      profile: {
        ...mappedUser,
        authorizedName,
        active: true,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "");

    if (message.includes("FIRESTORE_OFFLINE")) {
      return {
        allowed: false,
        reason: "FIRESTORE_OFFLINE",
        profile: null,
      };
    }

    if (message.includes("FIRESTORE_PERMISSION_DENIED")) {
      return {
        allowed: false,
        reason: "FIRESTORE_PERMISSION_DENIED",
        profile: null,
      };
    }

    console.error("[Auth] Error validando usuario autorizado:", error);

    return {
      allowed: false,
      reason: "AUTHORIZATION_CHECK_FAILED",
      profile: null,
    };
  }
}

/**
 * Inicia sesión con Google.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   user: object | null,
 *   error: string | null
 * }>}
 */
async function loginWithGoogle() {
  try {
    console.log("[Auth] Iniciando login con Google...");
    const result = await signInWithPopup(auth, googleProvider);
    const user = mapFirebaseUser(result.user);

    console.log("[Auth] Login exitoso:", user?.email || null);

    return {
      ok: true,
      user,
      error: null,
    };
  } catch (error) {
    console.error("[Auth] Error en login con Google:", error);

    return {
      ok: false,
      user: null,
      error: getAuthErrorMessage(error),
    };
  }
}

/**
 * Cierra sesión.
 *
 * @returns {Promise<void>}
 */
async function logout() {
  console.log("[Auth] Cerrando sesión...");
  await signOut(auth);
}

/**
 * Devuelve el usuario autenticado actual ya mapeado.
 *
 * @returns {object|null}
 */
function getCurrentUser() {
  return mapFirebaseUser(auth.currentUser);
}

/**
 * Escucha cambios de sesión.
 *
 * @param {(payload: {
 *   isAuthenticated: boolean,
 *   firebaseUser: any,
 *   user: object | null
 * }) => void} callback
 * @returns {() => void}
 */
function observeAuth(callback) {
  if (typeof callback !== "function") {
    throw new Error("observeAuth requiere un callback válido.");
  }

  return onAuthStateChanged(
    auth,
    (firebaseUser) => {
      const user = mapFirebaseUser(firebaseUser);

      console.log("[Auth] Cambio de sesión detectado:", {
        isAuthenticated: Boolean(firebaseUser),
        email: user?.email || null,
      });

      callback({
        isAuthenticated: Boolean(firebaseUser),
        firebaseUser,
        user,
      });
    },
    (error) => {
      console.error("[Auth] Error en onAuthStateChanged:", error);

      callback({
        isAuthenticated: false,
        firebaseUser: null,
        user: null,
        error,
      });
    }
  );
}

/**
 * Devuelve un mensaje amable según la causa de denegación.
 *
 * @param {string | null} reason
 * @param {string} [email]
 * @returns {string}
 */
function getAccessDeniedMessage(reason, email = "") {
  const safeEmail = normalizeEmail(email);

  switch (reason) {
    case "NO_AUTH_USER":
      return "No hay una sesión activa para validar acceso.";

    case "EMAIL_NOT_AVAILABLE":
      return "La cuenta inició sesión, pero no entregó un correo válido para verificar el acceso.";

    case "USER_NOT_FOUND":
      return safeEmail
        ? `El correo ${safeEmail} no aparece registrado como autorizado en la biblioteca.`
        : "Este correo no aparece registrado como autorizado en la biblioteca.";

    case "USER_INACTIVE":
      return safeEmail
        ? `El correo ${safeEmail} existe, pero actualmente no está activo para ingresar a la biblioteca.`
        : "Esta cuenta existe, pero actualmente no está activa para ingresar a la biblioteca.";

    case "FIRESTORE_OFFLINE":
      return "No fue posible validar el acceso porque Firestore no respondió. Revisen la conexión o la configuración de Firestore.";

    case "FIRESTORE_PERMISSION_DENIED":
      return "Firestore rechazó la lectura del usuario autorizado. Revisen las reglas de seguridad.";

    case "AUTHORIZATION_CHECK_FAILED":
      return "Ocurrió un problema inesperado al validar el acceso en Firestore.";

    default:
      return "Esta cuenta no tiene acceso habilitado a la biblioteca en este momento.";
  }
}

export {
  normalizeEmail,
  mapFirebaseUser,
  getCurrentUser,
  loginWithGoogle,
  logout,
  observeAuth,
  getAuthorizedUserRecord,
  validateAuthorizedUser,
  getAccessDeniedMessage,
  getAuthErrorMessage,
};