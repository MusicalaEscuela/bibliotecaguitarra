/**
 * ============================================================================
 * API
 * Biblioteca de Guitarra - Musicala
 * ----------------------------------------------------------------------------
 * Conecta el frontend con Google Apps Script para leer la biblioteca
 * almacenada en Google Sheets.
 *
 * Espera una respuesta JSON desde Apps Script.
 * ============================================================================
 */

/**
 * ============================================================================
 * CONFIG
 * ============================================================================
 */
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxmVRMIyl22SzirDMNISuzrgCx-odEyG044mt6T3I6RyuXeQOgG_6a7CFLHhK2hqV8/exec";

const REQUEST_TIMEOUT_MS = 15000;
const DEBUG_API = true;
const DEFAULT_SHEET_NAME = "Biblioteca";

const EXPECTED_FIELDS = {
  id: "ID",
  name: "Nombre",
  level: "Nivel",
  author: "Autor",
  category: "Categoría",
  notes: "Observaciones",
  link: "Link",
  active: "Activo",
  order: "Orden",
};

/**
 * ============================================================================
 * HELPERS BASE
 * ============================================================================
 */

/**
 * Convierte cualquier valor a string limpio.
 *
 * @param {unknown} value
 * @returns {string}
 */
function toCleanString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Convierte un texto a minúsculas y sin tildes.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  return toCleanString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Convierte un encabezado a una llave estable.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeKey(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Normaliza espacios múltiples.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeWhitespace(value) {
  return toCleanString(value).replace(/\s+/g, " ").trim();
}

/**
 * Limpia una URL.
 *
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeUrl(value) {
  return toCleanString(value).replace(/\s/g, "");
}

/**
 * Log condicional para debug.
 *
 * @param {...any} args
 */
function debugLog(...args) {
  if (!DEBUG_API) return;
  console.log("[Biblioteca API]", ...args);
}

/**
 * Log condicional de error.
 *
 * @param {...any} args
 */
function debugError(...args) {
  if (!DEBUG_API) return;
  console.error("[Biblioteca API]", ...args);
}

/**
 * ============================================================================
 * PARSERS
 * ============================================================================
 */

/**
 * Normaliza booleanos comunes que llegan desde Sheets.
 *
 * @param {unknown} value
 * @param {boolean} [defaultValue=false]
 * @returns {boolean}
 */
function parseBoolean(value, defaultValue = false) {
  if (value === null || value === undefined || toCleanString(value) === "") {
    return defaultValue;
  }

  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const normalized = normalizeText(value);

  return [
    "true",
    "1",
    "si",
    "sí",
    "yes",
    "y",
    "activo",
    "activa",
    "ok",
    "x",
    "habilitado",
    "visible",
  ].includes(normalized);
}

/**
 * Convierte un posible número a number usable.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function parseOrder(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const normalized = toCleanString(value)
    .replace(/\s+/g, "")
    .replace(",", ".");

  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Revisa si una URL parece válida para abrir externamente.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidExternalUrl(value) {
  const url = sanitizeUrl(value);
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Genera un slug simple.
 *
 * @param {unknown} value
 * @returns {string}
 */
function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * ============================================================================
 * LECTURA TOLERANTE DE CAMPOS
 * ============================================================================
 */

/**
 * Busca varias formas posibles de una clave dentro de un objeto.
 *
 * @param {Record<string, any>} row
 * @param {string[]} candidates
 * @returns {any}
 */
function getFirstValue(row, candidates) {
  if (!row || typeof row !== "object") return "";

  for (const candidate of candidates) {
    const directKey = toCleanString(candidate);
    const normalizedCandidate = normalizeKey(candidate);

    if (Object.prototype.hasOwnProperty.call(row, directKey)) {
      return row[directKey];
    }

    if (normalizedCandidate && Object.prototype.hasOwnProperty.call(row, normalizedCandidate)) {
      return row[normalizedCandidate];
    }
  }

  return "";
}

/**
 * Obtiene un campo tolerando variaciones comunes de nombre.
 *
 * @param {Record<string, any>} row
 * @param {"id"|"name"|"level"|"author"|"category"|"notes"|"link"|"active"|"order"} field
 * @returns {any}
 */
function getFieldValue(row, field) {
  const map = {
    id: [
      EXPECTED_FIELDS.id,
      "Id",
      "id",
    ],
    name: [
  EXPECTED_FIELDS.name,
    "Nombre",
    "nombre",
    "name",
    "Name",
    "Nombre de la herramienta/guía/libro",
    "nombre de la herramienta/guia/libro",
    "Título",
    "Titulo",
    "titulo",
    "título",
    "title",
    "Title",
    "recurso",
    "material",
    "nombre_recurso",
    ],
    level: [
      EXPECTED_FIELDS.level,
      "Nivel",
      "nivel",
      "level",
      "Level",
    ],
    author: [
      EXPECTED_FIELDS.author,
      "Autor",
      "autor",
      "author",
      "Author",
    ],
    category: [
      EXPECTED_FIELDS.category,
      "Categoría",
      "Categoria",
      "categoría",
      "categoria",
      "category",
      "Category",
    ],
    notes: [
      EXPECTED_FIELDS.notes,
      "Observaciones",
      "observaciones",
      "Observación",
      "observacion",
      "descripcion",
      "descripción",
      "Descripción",
      "Descripcion",
      "detalle",
      "detalles",
      "notes",
      "Notes",
    ],
    link: [
      EXPECTED_FIELDS.link,
      "Link",
      "link",
      "Enlace",
      "enlace",
      "url",
      "URL",
      "Url",
      "Vínculo",
      "Vinculo",
      "vinculo",
    ],
    active: [
      EXPECTED_FIELDS.active,
      "Activo",
      "activo",
      "Activa",
      "Activa?",
      "active",
      "Active",
      "Estado",
      "estado",
      "habilitado",
    ],
    order: [
      EXPECTED_FIELDS.order,
      "Orden",
      "orden",
      "order",
      "Order",
      "posición",
      "posicion",
      "Posición",
      "Posicion",
    ],
  };

  return getFirstValue(row, map[field] || []);
}

/**
 * ============================================================================
 * NORMALIZACIÓN DE RECURSOS
 * ============================================================================
 */

/**
 * Genera un id estable para renderizado.
 *
 * @param {Record<string, any>} resource
 * @param {number} index
 * @returns {string}
 */
function buildResourceId(resource, index) {
  const explicitId = toCleanString(resource.id);
  if (explicitId) return explicitId;

  const base = [
    "guitarra",
    resource.name,
    resource.author,
    resource.category,
    resource.level,
    index + 1,
  ]
    .map((part) => slugify(part))
    .filter(Boolean)
    .join("-");

  return base || `resource-${index + 1}`;
}

/**
 * Normaliza una fila proveniente de Sheets / Apps Script.
 *
 * @param {Record<string, any>} row
 * @param {number} [index=0]
 * @returns {{
 *   id: string,
 *   name: string,
 *   level: string,
 *   author: string,
 *   category: string,
 *   notes: string,
 *   link: string,
 *   hasLink: boolean,
 *   active: boolean,
 *   order: number|null,
 *   searchText: string,
 *   __rawName: string
 * }}
 */
function normalizeResource(row, index = 0) {
  const rawName = normalizeWhitespace(getFieldValue(row, "name"));
  const rawLevel = normalizeWhitespace(getFieldValue(row, "level"));
  const rawAuthor = normalizeWhitespace(getFieldValue(row, "author"));
  const rawCategory = normalizeWhitespace(getFieldValue(row, "category"));
  const rawNotes = normalizeWhitespace(getFieldValue(row, "notes"));
  const rawLink = sanitizeUrl(getFieldValue(row, "link"));
  const rawId = normalizeWhitespace(getFieldValue(row, "id"));
  const rawActive = getFieldValue(row, "active");
  const rawOrder = getFieldValue(row, "order");

  const resource = {
    id: "",
    name: rawName || "Recurso sin nombre",
    level: rawLevel || "Sin nivel",
    author: rawAuthor || "Sin autor",
    category: rawCategory || "Sin categoría",
    notes: rawNotes,
    link: rawLink,
    hasLink: isValidExternalUrl(rawLink),
    active: parseBoolean(rawActive, true),
    order: parseOrder(rawOrder),
    searchText: "",
    __rawName: rawName,
  };

  resource.id = buildResourceId(
    {
      id: rawId,
      name: resource.name,
      author: resource.author,
      category: resource.category,
      level: resource.level,
    },
    index
  );

  resource.searchText = [
    resource.id,
    resource.name,
    resource.level,
    resource.author,
    resource.category,
    resource.notes,
  ]
    .map(normalizeText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return resource;
}

/**
 * Ordena recursos:
 * 1. por order si existe
 * 2. luego por nombre
 * 3. luego por autor
 * 4. luego por id
 *
 * @param {Array<any>} resources
 * @returns {Array<any>}
 */
function sortResources(resources) {
  return [...resources].sort((a, b) => {
    const aHasOrder = typeof a.order === "number";
    const bHasOrder = typeof b.order === "number";

    if (aHasOrder && bHasOrder && a.order !== b.order) {
      return a.order - b.order;
    }

    if (aHasOrder && !bHasOrder) return -1;
    if (!aHasOrder && bHasOrder) return 1;

    const byName = a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    if (byName !== 0) return byName;

    const byAuthor = a.author.localeCompare(b.author, "es", { sensitivity: "base" });
    if (byAuthor !== 0) return byAuthor;

    return a.id.localeCompare(b.id, "es", { sensitivity: "base" });
  });
}

/**
 * ============================================================================
 * RESPUESTA / PAYLOAD
 * ============================================================================
 */

/**
 * Intenta extraer un arreglo usable desde diferentes formatos de respuesta.
 *
 * @param {any} payload
 * @returns {Array<Record<string, any>>}
 */
function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.resources)) return payload.resources;
  if (Array.isArray(payload?.rows)) return payload.rows;

  debugError("Payload no reconocido:", payload);
  throw new Error("INVALID_RESPONSE");
}

/**
 * Toma solo una muestra de filas para depurar.
 *
 * @param {Array<any>} rows
 * @param {number} [limit=3]
 * @returns {Array<any>}
 */
function getRowsPreview(rows, limit = 3) {
  return Array.isArray(rows) ? rows.slice(0, limit) : [];
}

/**
 * ============================================================================
 * ERRORES
 * ============================================================================
 */

/**
 * Devuelve mensaje claro de error según lo que pasó.
 *
 * @param {unknown} error
 * @returns {string}
 */
function getApiErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (message.includes("TIMEOUT")) {
    return "La solicitud tardó demasiado. Revisen la conexión o el Apps Script.";
  }

  if (message.includes("INVALID_CONFIG")) {
    return "La URL de Apps Script no está configurada correctamente.";
  }

  if (message.includes("HTTP_ERROR")) {
    return "La consulta al servicio de biblioteca respondió con error.";
  }

  if (message.includes("INVALID_RESPONSE")) {
    return "La respuesta del servicio no tiene el formato esperado.";
  }

  if (message.includes("BACKEND_ERROR")) {
    return "El Apps Script respondió con un error.";
  }

  if (message.includes("Failed to fetch")) {
    return "No se pudo conectar con el servicio de biblioteca.";
  }

  return "No fue posible cargar la biblioteca en este momento.";
}

/**
 * ============================================================================
 * FETCH
 * ============================================================================
 */

/**
 * Hace fetch con timeout.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("TIMEOUT");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Construye la URL final de consulta.
 *
 * @param {{ sheetName?: string, action?: string }} [options]
 * @returns {string}
 */
function buildApiUrl(options = {}) {
  const baseUrl = toCleanString(APPS_SCRIPT_URL);

  if (!baseUrl || baseUrl.startsWith("TU_")) {
    throw new Error("INVALID_CONFIG");
  }

  const action = toCleanString(options.action || "library");
  const sheetName = toCleanString(options.sheetName || "");

  const url = new URL(baseUrl);
  url.searchParams.set("action", action);

  if (sheetName) {
    url.searchParams.set("sheet", sheetName);
  }

  return url.toString();
}

/**
 * Hace la llamada y devuelve el payload JSON.
 *
 * @param {{ sheetName?: string, action?: string }} [options]
 * @returns {Promise<any>}
 */
async function requestJson(options = {}) {
  const url = buildApiUrl(options);

  debugLog("Consultando URL:", url);

  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      cache: "no-store",
    },
    REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`HTTP_ERROR:${response.status}`);
  }

  const payload = await response.json();

  debugLog("Payload recibido:", payload);

  if (payload && typeof payload === "object" && payload.ok === false) {
    const backendMessage = toCleanString(payload.error) || "Error desconocido en backend";
    throw new Error(`BACKEND_ERROR:${backendMessage}`);
  }

  return payload;
}

/**
 * ============================================================================
 * API PÚBLICA
 * ============================================================================
 */

/**
 * Healthcheck del Apps Script para confirmar deployment correcto.
 *
 * @param {{ sheetName?: string }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   data: Record<string, any> | null,
 *   error: string | null
 * }>}
 */
async function checkLibraryService(options = {}) {
  try {
    const payload = await requestJson({
      action: "health",
      sheetName: options.sheetName || DEFAULT_SHEET_NAME,
    });

    return {
      ok: true,
      data: payload,
      error: null,
    };
  } catch (error) {
    debugError("Error en checkLibraryService:", error);

    return {
      ok: false,
      data: null,
      error: getApiErrorMessage(error),
    };
  }
}

/**
 * Trae la biblioteca desde Apps Script, la normaliza y deja solo
 * los recursos activos.
 *
 * @param {{
 *   sheetName?: string,
 *   discardNameless?: boolean
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   data: Array<{
 *     id: string,
 *     name: string,
 *     level: string,
 *     author: string,
 *     category: string,
 *     notes: string,
 *     link: string,
 *     hasLink: boolean,
 *     active: boolean,
 *     order: number|null,
 *     searchText: string
 *   }>,
 *   total: number,
 *   error: string | null,
 *   meta: {
 *     sourceUrl: string,
 *     totalRowsReceived: number,
 *     totalRowsReturned: number,
 *     totalDiscardedInactive: number,
 *     totalDiscardedNameless: number,
 *     payloadPreview: Array<any>,
 *     normalizedPreview: Array<any>
 *   } | null
 * }>}
 */
async function fetchLibrary(options = {}) {
  try {
    const discardNameless = options.discardNameless !== false;
    const sourceUrl = buildApiUrl({
      action: "library",
      sheetName: options.sheetName || DEFAULT_SHEET_NAME,
    });

    const payload = await requestJson({
      action: "library",
      sheetName: options.sheetName || DEFAULT_SHEET_NAME,
    });

    const rows = extractRows(payload);
    const payloadPreview = getRowsPreview(rows, 3);

    debugLog("Total filas recibidas:", rows.length);
    debugLog("Preview filas crudas:", payloadPreview);

    const normalizedResources = rows.map((row, index) => normalizeResource(row, index));
    const normalizedPreview = normalizedResources.slice(0, 3);

    let totalDiscardedInactive = 0;
    let totalDiscardedNameless = 0;

    const filteredResources = normalizedResources.filter((resource) => {
      if (!resource.active) {
        totalDiscardedInactive += 1;
        return false;
      }

      if (discardNameless && !resource.__rawName) {
        totalDiscardedNameless += 1;
        return false;
      }

      return true;
    });

    const sortedResources = sortResources(filteredResources).map((resource) => {
      const cleaned = { ...resource };
      delete cleaned.__rawName;
      return cleaned;
    });

    debugLog("Preview filas normalizadas:", normalizedPreview);
    debugLog("Total recursos devueltos:", sortedResources.length);
    debugLog("Descartados inactivos:", totalDiscardedInactive);
    debugLog("Descartados sin nombre:", totalDiscardedNameless);

    return {
      ok: true,
      data: sortedResources,
      total: sortedResources.length,
      error: null,
      meta: {
        sourceUrl,
        totalRowsReceived: rows.length,
        totalRowsReturned: sortedResources.length,
        totalDiscardedInactive,
        totalDiscardedNameless,
        payloadPreview,
        normalizedPreview: normalizedPreview.map((resource) => {
          const cleaned = { ...resource };
          delete cleaned.__rawName;
          return cleaned;
        }),
      },
    };
  } catch (error) {
    debugError("Error en fetchLibrary:", error);

    return {
      ok: false,
      data: [],
      total: 0,
      error: getApiErrorMessage(error),
      meta: null,
    };
  }
}

/**
 * Obtiene valores únicos de una propiedad para poblar filtros.
 *
 * @param {Array<Record<string, any>>} resources
 * @param {"category"|"level"|"author"} key
 * @returns {string[]}
 */
function getUniqueValues(resources, key) {
  const values = new Set();

  for (const resource of resources) {
    const value = toCleanString(resource?.[key]);
    if (value) {
      values.add(value);
    }
  }

  return [...values].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
}

export {
  APPS_SCRIPT_URL,
  REQUEST_TIMEOUT_MS,
  DEBUG_API,
  buildApiUrl,
  checkLibraryService,
  fetchLibrary,
  normalizeResource,
  getUniqueValues,
  getApiErrorMessage,
};