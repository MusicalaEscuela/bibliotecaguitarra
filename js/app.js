import {
  loginWithGoogle,
  logout,
  observeAuth,
  validateAuthorizedUser,
  getAccessDeniedMessage,
} from "./auth.js";

import {
  fetchLibrary,
  getUniqueValues,
  checkLibraryService,
} from "./api.js";

/**
 * ============================================================================
 * APP
 * Biblioteca de Guitarra - Musicala
 * ============================================================================
 */

const AUTH_BOOT_TIMEOUT_MS = 5000;
const APP_DEBUG = true;

const state = {
  authResolved: false,
  currentUser: null,
  accessProfile: null,

  libraryLoaded: false,
  libraryLoading: false,
  libraryError: "",

  resources: [],
  filteredResources: [],

  diagnostics: {
    sourceUrl: "",
    totalRowsReceived: 0,
    totalRowsReturned: 0,
    totalDiscardedInactive: 0,
    totalDiscardedNameless: 0,
    payloadPreview: [],
    normalizedPreview: [],
    healthVersion: "",
    healthSheetName: "",
  },

  filters: {
    search: "",
    category: "",
    level: "",
  },
};

const $ = {
  viewLoading: document.getElementById("viewLoading"),
  viewLogin: document.getElementById("viewLogin"),
  viewDenied: document.getElementById("viewDenied"),
  viewLibrary: document.getElementById("viewLibrary"),

  btnLoginGoogle: document.getElementById("btnLoginGoogle"),
  btnLogout: document.getElementById("btnLogout"),
  btnDeniedLogout: document.getElementById("btnDeniedLogout"),
  btnBackToLogin: document.getElementById("btnBackToLogin"),
  btnRetryLoad: document.getElementById("btnRetryLoad"),
  btnClearFilters: document.getElementById("btnClearFilters"),

  loginError: document.getElementById("loginError"),
  deniedMessage: document.getElementById("deniedMessage"),
  libraryErrorMessage: document.getElementById("libraryErrorMessage"),
  libraryFeedback: document.getElementById("libraryFeedback"),

  userBadge: document.getElementById("userBadge"),
  userInitial: document.getElementById("userInitial"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),

  resultsCount: document.getElementById("resultsCount"),
  categoriesCount: document.getElementById("categoriesCount"),

  searchInput: document.getElementById("searchInput"),
  categoryFilter: document.getElementById("categoryFilter"),
  levelFilter: document.getElementById("levelFilter"),

  libraryLoading: document.getElementById("libraryLoading"),
  libraryError: document.getElementById("libraryError"),
  libraryEmpty: document.getElementById("libraryEmpty"),
  resourcesGrid: document.getElementById("resourcesGrid"),
};

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function debugLog(...args) {
  if (!APP_DEBUG) return;
  console.log("[Biblioteca App]", ...args);
}

function debugWarn(...args) {
  if (!APP_DEBUG) return;
  console.warn("[Biblioteca App]", ...args);
}

function debugError(...args) {
  if (!APP_DEBUG) return;
  console.error("[Biblioteca App]", ...args);
}

function safeText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = hidden;
}

function showOnlyView(viewName) {
  const views = ["viewLoading", "viewLogin", "viewDenied", "viewLibrary"];
  for (const key of views) {
    setHidden($[key], key !== viewName);
  }
}

function clearLoginError() {
  if (!$.loginError) return;
  $.loginError.textContent = "";
  $.loginError.hidden = true;
}

function showLoginError(message) {
  if (!$.loginError) return;
  $.loginError.textContent = safeText(message) || "No fue posible iniciar sesión.";
  $.loginError.hidden = false;
}

function setInlineFeedback(message = "") {
  if (!$.libraryFeedback) return;
  const clean = safeText(message);
  $.libraryFeedback.textContent = clean;
  $.libraryFeedback.hidden = !clean;
}

function clearInlineFeedback() {
  setInlineFeedback("");
}

function resetDiagnostics() {
  state.diagnostics = {
    sourceUrl: "",
    totalRowsReceived: 0,
    totalRowsReturned: 0,
    totalDiscardedInactive: 0,
    totalDiscardedNameless: 0,
    payloadPreview: [],
    normalizedPreview: [],
    healthVersion: "",
    healthSheetName: "",
  };
}

function updateHeaderUser(profile) {
  if (!profile) {
    setHidden($.userBadge, true);
    setHidden($.btnLogout, true);

    if ($.userInitial) $.userInitial.textContent = "M";
    if ($.userName) $.userName.textContent = "Estudiante";
    if ($.userEmail) $.userEmail.textContent = "correo@musicala.com";
    return;
  }

  const displayName = safeText(profile.authorizedName || profile.name || "Estudiante");
  const displayEmail = safeText(profile.email);
  const initial = safeText(profile.initial || displayName.charAt(0) || "M")
    .charAt(0)
    .toUpperCase();

  if ($.userInitial) $.userInitial.textContent = initial;
  if ($.userName) $.userName.textContent = displayName;
  if ($.userEmail) $.userEmail.textContent = displayEmail;

  setHidden($.userBadge, false);
  setHidden($.btnLogout, false);
}

function setLibraryStats(resources) {
  const totalResults = Array.isArray(resources) ? resources.length : 0;
  const totalCategories = getUniqueValues(state.resources, "category").length;

  if ($.resultsCount) $.resultsCount.textContent = String(totalResults);
  if ($.categoriesCount) $.categoriesCount.textContent = String(totalCategories);
}

function populateSelectOptions(selectElement, values, placeholder) {
  if (!selectElement) return;

  const currentValue = selectElement.value;
  const uniqueValues = Array.isArray(values) ? values : [];

  selectElement.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  selectElement.appendChild(placeholderOption);

  for (const value of uniqueValues) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  }

  selectElement.value = uniqueValues.includes(currentValue) ? currentValue : "";
}

function syncFiltersToDom() {
  if ($.searchInput) $.searchInput.value = state.filters.search;
  if ($.categoryFilter) $.categoryFilter.value = state.filters.category;
  if ($.levelFilter) $.levelFilter.value = state.filters.level;
}

function resetFilters() {
  state.filters.search = "";
  state.filters.category = "";
  state.filters.level = "";
  syncFiltersToDom();
}

function setLibraryLoading(isLoading) {
  state.libraryLoading = Boolean(isLoading);
  setHidden($.libraryLoading, !isLoading);

  if ($.btnRetryLoad) {
    $.btnRetryLoad.disabled = Boolean(isLoading);
  }

  if ($.btnClearFilters) {
    $.btnClearFilters.disabled = Boolean(isLoading);
  }
}

function setLibraryError(message = "") {
  const clean = safeText(message);
  state.libraryError = clean;

  if ($.libraryErrorMessage) {
    $.libraryErrorMessage.textContent =
      clean || "Ocurrió un problema al consultar los recursos disponibles.";
  }

  setHidden($.libraryError, !clean);
}

function setEmptyState(isEmpty) {
  setHidden($.libraryEmpty, !isEmpty);
}

function hideLibrarySecondaryStates() {
  setLibraryLoading(false);
  setLibraryError("");
  setEmptyState(false);
}

function updateLibrarySurface() {
  const hasResources = state.filteredResources.length > 0;
  const hasError = Boolean(state.libraryError);
  const isLoading = state.libraryLoading;

  setHidden($.resourcesGrid, isLoading || hasError || !hasResources);
  setEmptyState(!isLoading && !hasError && state.libraryLoaded && !hasResources);
  setLibraryStats(state.filteredResources);
}

function formatLibraryDiagnosticsMessage() {
  const total = state.diagnostics.totalRowsReturned || state.resources.length || 0;
  const discardedInactive = state.diagnostics.totalDiscardedInactive || 0;
  const discardedNameless = state.diagnostics.totalDiscardedNameless || 0;
  const version = safeText(state.diagnostics.healthVersion);
  const sheetName = safeText(state.diagnostics.healthSheetName);

  const parts = [`${total} recursos cargados`];

  if (discardedInactive > 0) {
    parts.push(`${discardedInactive} inactivos omitidos`);
  }

  if (discardedNameless > 0) {
    parts.push(`${discardedNameless} sin nombre omitidos`);
  }

  if (sheetName) {
    parts.push(`hoja: ${sheetName}`);
  }

  if (version) {
    parts.push(`versión: ${version}`);
  }

  return parts.join(" · ");
}

function sanitizeResources(resources) {
  if (!Array.isArray(resources)) return [];

  return resources.filter((resource) => {
    if (!resource || typeof resource !== "object") return false;
    if (!safeText(resource.id)) return false;
    if (!safeText(resource.name)) return false;
    return true;
  });
}

function buildResourceCard(resource) {
  const name = escapeHtml(resource.name || "Recurso sin nombre");
  const level = escapeHtml(resource.level || "Sin nivel");
  const author = escapeHtml(resource.author || "Sin autor");
  const category = escapeHtml(resource.category || "Sin categoría");
  const notes = escapeHtml(resource.notes || "");
  const link = safeText(resource.link);
  const hasLink = resource.hasLink === true;

  return `
    <article class="resource-card" data-id="${escapeHtml(resource.id)}">
      <div class="resource-card__header">
        <h3 class="resource-card__title">${name}</h3>

        <div class="resource-card__meta">
          <span class="resource-badge resource-badge--category">${category}</span>
          <span class="resource-badge resource-badge--level">${level}</span>
        </div>
      </div>

      <div class="resource-card__body">
        <div class="resource-info">
          <div class="resource-info__row">
            <span class="resource-info__label">Autor</span>
            <span>${author}</span>
          </div>

          <div class="resource-info__row">
            <span class="resource-info__label">Nivel</span>
            <span>${level}</span>
          </div>

          <div class="resource-info__row">
            <span class="resource-info__label">Categoría</span>
            <span>${category}</span>
          </div>
        </div>

        ${notes ? `<div class="resource-card__observations">${notes}</div>` : ""}
      </div>

      <div class="resource-card__footer">
        ${
          hasLink
            ? `
              <a
                class="resource-link"
                href="${escapeHtml(link)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="resource-link__icon" aria-hidden="true">↗</span>
                Abrir recurso
              </a>
            `
            : `
              <span class="resource-link resource-link--disabled" aria-disabled="true">
                <span class="resource-link__icon" aria-hidden="true">—</span>
                Sin enlace disponible
              </span>
            `
        }
      </div>
    </article>
  `;
}

function renderResources() {
  if (!$.resourcesGrid) return;

  $.resourcesGrid.innerHTML = state.filteredResources
    .map((resource) => buildResourceCard(resource))
    .join("");

  updateLibrarySurface();
}

function applyFilters() {
  const query = normalizeText(state.filters.search);
  const selectedCategory = safeText(state.filters.category);
  const selectedLevel = safeText(state.filters.level);

  state.filteredResources = state.resources.filter((resource) => {
    if (selectedCategory && resource.category !== selectedCategory) return false;
    if (selectedLevel && resource.level !== selectedLevel) return false;

    if (query) {
      const haystack = normalizeText(resource.searchText || "");
      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  debugLog("Filtros aplicados:", {
    search: state.filters.search,
    category: state.filters.category,
    level: state.filters.level,
    totalFiltered: state.filteredResources.length,
  });

  renderResources();
}

function populateFilters(resources) {
  populateSelectOptions(
    $.categoryFilter,
    getUniqueValues(resources, "category"),
    "Todas las categorías"
  );

  populateSelectOptions(
    $.levelFilter,
    getUniqueValues(resources, "level"),
    "Todos los niveles"
  );
}

async function runLibraryHealthcheck() {
  try {
    const result = await checkLibraryService();

    if (!result.ok || !result.data) {
      debugWarn("Healthcheck no disponible:", result.error);
      return;
    }

    state.diagnostics.healthVersion = safeText(result.data.version);
    state.diagnostics.healthSheetName = safeText(
      result.data.resolvedSheetName || result.data.sheetName
    );

    debugLog("Healthcheck backend:", result.data);
  } catch (error) {
    debugWarn("No se pudo ejecutar healthcheck:", error);
  }
}

async function loadLibrary() {
  if (state.libraryLoading) return;

  clearInlineFeedback();
  setLibraryError("");
  setEmptyState(false);
  setLibraryLoading(true);
  setHidden($.resourcesGrid, true);
  resetDiagnostics();

  debugLog("Cargando biblioteca...");

  await runLibraryHealthcheck();

  const result = await fetchLibrary({
    discardNameless: true,
  });

  setLibraryLoading(false);

  if (!result.ok) {
    debugError("Error cargando biblioteca:", result.error);

    state.libraryLoaded = false;
    state.resources = [];
    state.filteredResources = [];
    resetDiagnostics();

    setLibraryError(result.error || "No fue posible cargar la biblioteca.");
    renderResources();
    return;
  }

  const cleanResources = sanitizeResources(result.data);

  state.diagnostics = {
    ...state.diagnostics,
    ...(result.meta || {}),
  };

  debugLog("Biblioteca cargada correctamente:", {
    total: cleanResources.length,
    diagnostics: state.diagnostics,
  });

  state.libraryLoaded = true;
  state.resources = cleanResources;
  populateFilters(state.resources);
  applyFilters();

  setInlineFeedback(formatLibraryDiagnosticsMessage());

  if (!cleanResources.length) {
    debugWarn("La biblioteca cargó sin recursos renderizables.", {
      meta: result.meta,
    });
  }
}

async function handleAuthorizedSession(profile) {
  state.accessProfile = profile || null;
  updateHeaderUser(profile);
  showOnlyView("viewLibrary");

  if (!state.libraryLoaded) {
    await loadLibrary();
    return;
  }

  setInlineFeedback(formatLibraryDiagnosticsMessage());
  applyFilters();
}

async function handleDeniedSession(reason, email = "") {
  state.accessProfile = null;
  state.resources = [];
  state.filteredResources = [];
  state.libraryLoaded = false;
  state.libraryLoading = false;
  state.libraryError = "";
  resetDiagnostics();

  updateHeaderUser(null);
  clearInlineFeedback();

  if ($.deniedMessage) {
    $.deniedMessage.textContent = getAccessDeniedMessage(reason, email);
  }

  showOnlyView("viewDenied");
}

async function handleSignedOutState() {
  state.currentUser = null;
  state.accessProfile = null;
  state.libraryLoaded = false;
  state.libraryLoading = false;
  state.libraryError = "";
  state.resources = [];
  state.filteredResources = [];
  resetDiagnostics();

  resetFilters();
  clearLoginError();
  clearInlineFeedback();
  updateHeaderUser(null);
  hideLibrarySecondaryStates();

  if ($.resourcesGrid) $.resourcesGrid.innerHTML = "";
  if ($.resultsCount) $.resultsCount.textContent = "0";
  if ($.categoriesCount) $.categoriesCount.textContent = "0";

  showOnlyView("viewLogin");
}

async function handleAuthChange(payload) {
  const { isAuthenticated, firebaseUser, user } = payload;

  debugLog("Auth change:", {
    isAuthenticated,
    email: user?.email || null,
  });

  state.authResolved = true;
  state.currentUser = user || null;

  clearLoginError();
  showOnlyView("viewLoading");

  if (!isAuthenticated || !firebaseUser) {
    await handleSignedOutState();
    return;
  }

  const access = await validateAuthorizedUser(firebaseUser);

  if (!access.allowed) {
    await handleDeniedSession(access.reason, user?.email || "");
    return;
  }

  await handleAuthorizedSession(access.profile);
}

async function onLoginClick() {
  clearLoginError();

  if ($.btnLoginGoogle) $.btnLoginGoogle.disabled = true;

  debugLog("Intentando login con Google...");

  const result = await loginWithGoogle();

  if ($.btnLoginGoogle) $.btnLoginGoogle.disabled = false;

  if (!result.ok) {
    debugError("Error login:", result.error);
    showLoginError(result.error || "No fue posible iniciar sesión.");
    return;
  }

  debugLog("Login exitoso:", result.user?.email || null);
}

async function onLogoutClick() {
  clearInlineFeedback();
  await logout();
}

async function onRetryLoadClick() {
  await loadLibrary();
}

function onSearchInput(event) {
  state.filters.search = safeText(event.target.value);
  applyFilters();
}

function onCategoryChange(event) {
  state.filters.category = safeText(event.target.value);
  applyFilters();
}

function onLevelChange(event) {
  state.filters.level = safeText(event.target.value);
  applyFilters();
}

function onClearFilters() {
  resetFilters();
  applyFilters();
  setInlineFeedback(formatLibraryDiagnosticsMessage());
}

async function onBackToLogin() {
  await logout();
}

function bindEvents() {
  $.btnLoginGoogle?.addEventListener("click", onLoginClick);
  $.btnLogout?.addEventListener("click", onLogoutClick);
  $.btnDeniedLogout?.addEventListener("click", onLogoutClick);
  $.btnBackToLogin?.addEventListener("click", onBackToLogin);
  $.btnRetryLoad?.addEventListener("click", onRetryLoadClick);
  $.btnClearFilters?.addEventListener("click", onClearFilters);

  $.searchInput?.addEventListener("input", onSearchInput);
  $.categoryFilter?.addEventListener("change", onCategoryChange);
  $.levelFilter?.addEventListener("change", onLevelChange);
}

function bootAuthObserver() {
  let resolved = false;

  const timeoutId = window.setTimeout(() => {
    if (resolved) return;

    debugWarn("Auth tardó demasiado. Se libera la pantalla de carga.");
    resolved = true;

    handleSignedOutState().catch((error) => {
      debugError("Error liberando fallback de auth:", error);
      showOnlyView("viewLogin");
      showLoginError("La app tardó demasiado en validar la sesión. Recarguen e intenten de nuevo.");
    });
  }, AUTH_BOOT_TIMEOUT_MS);

  try {
    observeAuth((payload) => {
      if (!resolved) {
        resolved = true;
        window.clearTimeout(timeoutId);
      }

      handleAuthChange(payload).catch((error) => {
        debugError("Error manejando sesión:", error);
        clearInlineFeedback();
        updateHeaderUser(null);
        setLibraryLoading(false);
        setLibraryError("Ocurrió un error inesperado al preparar la aplicación.");
        showOnlyView("viewLogin");
        showLoginError("Ocurrió un error inesperado. Recarguen la página e intenten nuevamente.");
      });
    });
  } catch (error) {
    window.clearTimeout(timeoutId);
    debugError("Error iniciando observer de auth:", error);
    showOnlyView("viewLogin");
    showLoginError("No se pudo iniciar la autenticación de Firebase.");
  }
}

function boot() {
  debugLog("Boot iniciando...");
  bindEvents();
  showOnlyView("viewLoading");
  bootAuthObserver();
}

boot();