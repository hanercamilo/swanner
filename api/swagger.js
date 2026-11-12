// ============================================================================
// Función Serverless Autónoma para Vercel: /api/swagger.js
// Diseñada para repositorios donde solo se sube el código compilado (dist/)
// sin package.json, sin node_modules y sin código fuente TypeScript (src/).
// Utiliza fetch nativo de Node.js (>=18) contra la API REST de Supabase.
// ============================================================================

function sanitizeComponentName(raw) {
  return String(raw || 'SchemaModel').replace(/[^a-zA-Z0-9_]/g, '_');
}

function inferOpenApiSchemaFromValue(value) {
  if (value === null || value === undefined) {
    return { type: 'string', nullable: true, example: null };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: 'array', items: { type: 'string' }, example: [] };
    }
    const firstNonNull = value.find((i) => i !== null && i !== undefined);
    return {
      type: 'array',
      items: inferOpenApiSchemaFromValue(firstNonNull ?? value[0]),
      example: value,
    };
  }
  if (typeof value === 'object') {
    const properties = {};
    const required = [];
    for (const [k, v] of Object.entries(value)) {
      properties[k] = inferOpenApiSchemaFromValue(v);
      if (v !== null && v !== undefined) required.push(k);
    }
    return { type: 'object', properties, required, example: value };
  }
  if (typeof value === 'boolean') return { type: 'boolean', example: value };
  if (typeof value === 'number') {
    return {
      type: Number.isInteger(value) ? 'integer' : 'number',
      example: value,
    };
  }
  return { type: 'string', example: String(value) };
}

function serializeSchemaNode(node) {
  if (!node) return { type: 'object' };
  const result = { type: node.type || 'object' };
  if (node.description) result.description = node.description;
  if (node.nullable) result.nullable = true;
  if (node.example !== undefined) result.example = node.example;

  if (node.type === 'object' && node.properties) {
    const props = {};
    for (const [k, v] of Object.entries(node.properties)) {
      props[k] = serializeSchemaNode(v);
    }
    result.properties = props;
    if (Array.isArray(node.required) && node.required.length > 0) {
      result.required = node.required;
    }
  } else if (node.type === 'array') {
    result.items = serializeSchemaNode(node.items || { type: 'string' });
  }
  return result;
}

function coerceExampleType(raw, type) {
  if (type === 'integer') {
    const p = parseInt(raw, 10);
    return Number.isNaN(p) ? raw : p;
  }
  if (type === 'number') {
    const p = parseFloat(raw);
    return Number.isNaN(p) ? raw : p;
  }
  if (type === 'boolean') {
    if (String(raw).toLowerCase() === 'true') return true;
    if (String(raw).toLowerCase() === 'false') return false;
  }
  return raw;
}

function buildOpenApiSpec(project, groups, endpoints) {
  const sortedGroups = [...(groups || [])].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
  );
  const sortedEndpoints = [...(endpoints || [])].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
  );

  const groupMap = new Map();
  for (const g of sortedGroups) groupMap.set(g.id, g);

  const tags = sortedGroups.map((g) => ({
    name: g.name,
    ...(g.description ? { description: g.description } : {}),
  }));

  const securitySchemes = {};
  const schemeKey = 'ProjectAuth';

  if (project.auth_enabled) {
    const headerName = String(project.auth_header_name || 'Authorization').trim();
    const prefix = project.auth_prefix !== null && project.auth_prefix !== undefined
      ? String(project.auth_prefix).trim()
      : '';
    const isStandardBearer =
      headerName.toLowerCase() === 'authorization' &&
      prefix.toLowerCase() === 'bearer';

    const baseDescription =
      project.auth_description ||
      `Autenticación mediante header ${headerName}${
        prefix ? ` (prefijo automático: ${prefix})` : ' (sin prefijo)'
      }. Introduce únicamente el valor del token.`;

    if (isStandardBearer) {
      securitySchemes[schemeKey] = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: baseDescription,
        'x-auth-header-name': headerName,
        'x-auth-prefix': prefix,
      };
    } else {
      securitySchemes[schemeKey] = {
        type: 'apiKey',
        in: 'header',
        name: headerName,
        description: baseDescription,
        'x-auth-header-name': headerName,
        'x-auth-prefix': prefix,
      };
    }
  }

  const paths = {};
  const componentSchemas = {};

  for (const ep of sortedEndpoints) {
    const pathKey = String(ep.path || '/').startsWith('/')
      ? ep.path
      : `/${ep.path}`;
    if (!paths[pathKey]) paths[pathKey] = {};

    const methodKey = String(ep.method || 'GET').toLowerCase();
    const groupName = groupMap.get(ep.group_id)?.name || 'General';
    const opId = ep.operation_id || `${methodKey}_${String(ep.id).slice(0, 8)}`;

    const openApiParams = (ep.parameters || []).map((param) => ({
      name: param.name,
      in: param.in,
      required: param.in === 'path' ? true : Boolean(param.required),
      ...(param.description ? { description: param.description } : {}),
      schema: {
        type: param.type || 'string',
        ...(param.example !== ''
          ? { example: coerceExampleType(param.example, param.type) }
          : {}),
      },
      ...(param.example !== ''
        ? { example: coerceExampleType(param.example, param.type) }
        : {}),
    }));

    let requestBodyObj = undefined;
    const methodsSupportingBody = new Set(['post', 'put', 'patch', 'delete']);
    if (
      methodsSupportingBody.has(methodKey) &&
      ep.request_body &&
      ep.request_body.enabled
    ) {
      const contentType = ep.request_body.contentType || 'application/json';
      let parsedExample = undefined;
      if (ep.request_body.exampleJson?.trim()) {
        try {
          parsedExample = JSON.parse(ep.request_body.exampleJson);
        } catch {
          parsedExample = ep.request_body.exampleJson;
        }
      }

      const activeSchema =
        ep.request_body.schema ||
        (parsedExample !== undefined
          ? inferOpenApiSchemaFromValue(parsedExample)
          : { type: 'object' });

      const schemaComponentName = sanitizeComponentName(`${opId}_Request`);
      componentSchemas[schemaComponentName] = serializeSchemaNode(activeSchema);

      requestBodyObj = {
        required: Boolean(ep.request_body.required),
        content: {
          [contentType]: {
            schema: { $ref: `#/components/schemas/${schemaComponentName}` },
            ...(parsedExample !== undefined ? { example: parsedExample } : {}),
          },
        },
      };
    }

    const responsesObj = {};
    const enabledResponses = (ep.responses || []).filter((r) => r.enabled);
    if (enabledResponses.length === 0) {
      responsesObj['200'] = { description: 'OK' };
    } else {
      for (const resp of enabledResponses) {
        const code = String(resp.statusCode || '200').trim();
        const contentType = resp.contentType || 'application/json';
        let parsedRespExample = undefined;
        if (resp.exampleJson?.trim()) {
          try {
            parsedRespExample = JSON.parse(resp.exampleJson);
          } catch {
            parsedRespExample = resp.exampleJson;
          }
        }

        if (resp.schema !== null || parsedRespExample !== undefined) {
          const respSchema =
            resp.schema ||
            (parsedRespExample !== undefined
              ? inferOpenApiSchemaFromValue(parsedRespExample)
              : { type: 'object' });
          const respComponentName = sanitizeComponentName(
            `${opId}_Response_${code}`
          );
          componentSchemas[respComponentName] = serializeSchemaNode(respSchema);
          responsesObj[code] = {
            description: resp.description || 'Respuesta del servidor',
            content: {
              [contentType]: {
                schema: { $ref: `#/components/schemas/${respComponentName}` },
                ...(parsedRespExample !== undefined
                  ? { example: parsedRespExample }
                  : {}),
              },
            },
          };
        } else {
          responsesObj[code] = {
            description: resp.description || 'Respuesta del servidor',
          };
        }
      }
    }

    paths[pathKey][methodKey] = {
      tags: [groupName],
      summary: ep.summary,
      description: ep.description || ep.summary,
      operationId: opId,
      parameters: openApiParams,
      ...(requestBodyObj ? { requestBody: requestBodyObj } : {}),
      responses: responsesObj,
      security:
        project.auth_enabled && ep.requires_auth ? [{ [schemeKey]: [] }] : [],
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: project.api_title || project.name,
      description:
        project.description ||
        `Documentación interactiva OpenAPI para ${
          project.api_title || project.name
        }.`,
      version: '1.0.0',
    },
    servers: [
      {
        url: String(project.base_url || '').replace(/\/+$/, ''),
        description: 'Servidor Principal de la API Original',
      },
    ],
    tags,
    paths,
    components: {
      schemas: componentSchemas,
      ...(Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
    },
    ...(project.auth_enabled ? { security: [{ [schemeKey]: [] }] } : {}),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).send('ok');
    return;
  }

  const slugParam = req.query?.slug;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;

  if (!slug) {
    res.status(400).json({ error: 'El parámetro slug es obligatorio.' });
    return;
  }

  // Valores públicos de Supabase (puedes definirlos en Environment Variables de Vercel
  // o pegarlos directamente como fallback aquí porque son la URL y anon key públicas)
  const supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).replace(/\/+$/, '');
  const supabaseKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({
      error:
        'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en las Environment Variables de tu proyecto en Vercel.',
    });
    return;
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: 'application/json',
  };

  try {
    const projResp = await fetch(
      `${supabaseUrl}/rest/v1/projects?slug=eq.${encodeURIComponent(
        slug
      )}&is_published=eq.true&select=*`,
      { headers }
    );
    const projects = await projResp.json();
    const project = Array.isArray(projects) ? projects[0] : null;

    if (!project) {
      res.status(404).json({
        error: `No existe documentación publicada para el proyecto "${slug}".`,
      });
      return;
    }

    const [groupsResp, endpointsResp] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/api_groups?project_id=eq.${project.id}&order=sort_order.asc&select=*`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/api_endpoints?project_id=eq.${project.id}&order=sort_order.asc&select=*`,
        { headers }
      ),
    ]);

    const groups = await groupsResp.json();
    const endpoints = await endpointsResp.json();

    const spec = buildOpenApiSpec(project, groups, endpoints);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(JSON.stringify(spec, null, 2));
  } catch (err) {
    res.status(500).json({
      error: 'Error al generar el documento OpenAPI desde Supabase.',
    });
  }
}
