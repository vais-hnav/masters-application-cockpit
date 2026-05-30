const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const path = normalizePath(params.path);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: jsonHeaders });
  }

  try {
    if (!env.DB) {
      return json({ error: "D1 binding DB is not configured." }, 500);
    }

    if (request.method === "GET" && path === "health") {
      return json({ ok: true, database: "connected" });
    }

    if (request.method === "GET" && path === "bootstrap") {
      return json(await loadBootstrap(env));
    }

    if (request.method === "GET" && path === "programs") {
      return json(await loadPrograms(env, url.searchParams.get("country")));
    }

    const programMatch = path.match(/^programs\/([^/]+)$/);
    if (request.method === "PATCH" && programMatch) {
      const auth = canWrite(request, env, url);
      if (!auth.allowed) {
        return json({ error: auth.reason }, 403);
      }
      return json({ row: await updateProgram(env, decodeURIComponent(programMatch[1]), await readJson(request), auth.user) });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error.message || "Unexpected API error" }, 500);
  }
}

function normalizePath(path) {
  if (Array.isArray(path)) {
    return path.join("/");
  }
  return path || "";
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders,
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function loadBootstrap(env) {
  const [metaRows, sectionRows, countryRows, columnRows, programRows] = await Promise.all([
    env.DB.prepare("SELECT key, value FROM app_meta").all(),
    env.DB.prepare("SELECT key, label, short_label, tone, description FROM sections ORDER BY display_order").all(),
    env.DB.prepare("SELECT name FROM countries ORDER BY display_order").all(),
    env.DB.prepare("SELECT country, key, label, source_label, letter, index_position FROM columns ORDER BY country, display_order").all(),
    env.DB.prepare("SELECT * FROM programs ORDER BY country, row_number").all(),
  ]);

  const meta = Object.fromEntries((metaRows.results || []).map((row) => [row.key, row.value]));
  const sections = (sectionRows.results || []).map(sectionFromRecord);
  const sectionMap = new Map(sections.map((section) => [section.key, section]));
  const columnsByCountry = groupColumns(columnRows.results || []);
  const rowsByCountry = groupPrograms(programRows.results || [], columnsByCountry, sectionMap);

  return {
    sourceFile: meta.sourceFile || "Cloudflare D1",
    generatedAt: meta.generatedAt || new Date().toISOString(),
    defaultCountry: meta.defaultCountry || "Germany",
    sections,
    sheets: (countryRows.results || []).map((country) => ({
      name: country.name,
      columns: columnsByCountry.get(country.name) || [],
      rows: rowsByCountry.get(country.name) || [],
    })),
  };
}

async function loadPrograms(env, country) {
  const bootstrap = await loadBootstrap(env);
  if (!country || country === "all") {
    return { rows: bootstrap.sheets.flatMap((sheet) => sheet.rows) };
  }
  const sheet = bootstrap.sheets.find((item) => item.name === country);
  return { rows: sheet ? sheet.rows : [] };
}

function sectionFromRecord(row) {
  return {
    key: row.key,
    label: row.label,
    shortLabel: row.short_label,
    tone: row.tone,
    description: row.description,
  };
}

function groupColumns(records) {
  const columnsByCountry = new Map();
  records.forEach((row) => {
    const columns = columnsByCountry.get(row.country) || [];
    columns.push({
      key: row.key,
      label: row.label,
      sourceLabel: row.source_label,
      letter: row.letter,
      index: row.index_position,
    });
    columnsByCountry.set(row.country, columns);
  });
  return columnsByCountry;
}

function groupPrograms(records, columnsByCountry, sectionMap) {
  const rowsByCountry = new Map();
  records.forEach((record) => {
    const row = programFromRecord(record, columnsByCountry.get(record.country) || [], sectionMap);
    const rows = rowsByCountry.get(row.country) || [];
    rows.push(row);
    rowsByCountry.set(row.country, rows);
  });
  return rowsByCountry;
}

function programFromRecord(record, columns, sectionMap) {
  const sourceBand = sectionMap.get(record.band_key) || {
    key: record.band_key,
    label: record.band_key,
    shortLabel: record.band_key,
    tone: "skipped",
    description: "",
  };

  return {
    id: record.id,
    country: record.country,
    rowNumber: record.row_number,
    sourceColor: record.source_color,
    sourceFontColors: parseJson(record.source_font_colors_json, []),
    sourceBand,
    fields: parseJson(record.fields_json, {}),
    links: parseJson(record.links_json, []),
    sourceColorsByColumn: parseJson(record.source_colors_by_column_json, {}),
    sourceFontColorsByColumn: parseJson(record.source_font_colors_by_column_json, {}),
    columns,
    updatedAt: record.updated_at,
    updatedBy: record.updated_by,
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

async function updateProgram(env, id, body, user) {
  const existing = await env.DB.prepare("SELECT * FROM programs WHERE id = ?").bind(id).first();
  if (!existing) {
    throw new Error("Program not found.");
  }

  const section = body.bandKey
    ? await env.DB.prepare("SELECT key FROM sections WHERE key = ?").bind(body.bandKey).first()
    : null;
  const nextBandKey = section ? body.bandKey : existing.band_key;
  const previousFields = parseJson(existing.fields_json, {});
  const nextFields = sanitizeFields({ ...previousFields, ...(body.fields || {}) });
  const columns = await env.DB.prepare(
    "SELECT key, label, source_label, letter, index_position FROM columns WHERE country = ? ORDER BY display_order",
  )
    .bind(existing.country)
    .all();
  const normalizedColumns = (columns.results || []).map((column) => ({
    key: column.key,
    label: column.label,
    sourceLabel: column.source_label,
    letter: column.letter,
    index: column.index_position,
  }));
  const nextLinks = buildLinks(nextFields, normalizedColumns);
  const now = new Date().toISOString();
  const previousSnapshot = JSON.stringify(existing);
  const nextSnapshot = JSON.stringify({
    ...existing,
    band_key: nextBandKey,
    fields_json: JSON.stringify(nextFields),
    links_json: JSON.stringify(nextLinks),
    updated_at: now,
    updated_by: user,
  });

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE programs SET band_key = ?, fields_json = ?, links_json = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    ).bind(nextBandKey, JSON.stringify(nextFields), JSON.stringify(nextLinks), now, user, id),
    env.DB.prepare(
      "INSERT INTO edit_history (program_id, previous_json, next_json, edited_at, edited_by) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, previousSnapshot, nextSnapshot, now, user),
  ]);

  const updated = await env.DB.prepare("SELECT * FROM programs WHERE id = ?").bind(id).first();
  const sectionRows = await env.DB.prepare(
    "SELECT key, label, short_label, tone, description FROM sections ORDER BY display_order",
  ).all();
  const sectionMap = new Map((sectionRows.results || []).map((row) => [row.key, sectionFromRecord(row)]));
  return programFromRecord(updated, normalizedColumns, sectionMap);
}

function sanitizeFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value == null ? "" : String(value).trim()]),
  );
}

function buildLinks(fields, columns) {
  return columns
    .map((column) => ({
      field: column.key,
      label: column.label,
      url: fields[column.key] || "",
    }))
    .filter((link) => /^https?:\/\//i.test(link.url));
}

function canWrite(request, env, url) {
  const accessUser = request.headers.get("cf-access-authenticated-user-email");
  if (accessUser) {
    return { allowed: true, user: accessUser };
  }

  const auth = request.headers.get("authorization") || "";
  if (env.EDIT_TOKEN && auth === `Bearer ${env.EDIT_TOKEN}`) {
    return { allowed: true, user: "edit-token" };
  }

  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    return { allowed: true, user: "local-dev" };
  }

  return {
    allowed: false,
    reason: "Editing requires Cloudflare Access or EDIT_TOKEN.",
  };
}
