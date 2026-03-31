const COLOR_MAP = {
  "Black": "0",
  "Blue": "1",
  "Tan": "2",
  "Orange": "4",
  "Yellow": "14",
  "White": "15",
  "Trans Green": "19",
  "Lime": "34",
  "Bright Green": "36",
  "Trans Clear": "40",
  "Trans Red": "41",
  "Trans Yellow": "47",
  "Light Bluish Gray": "71",
  "Dark Bluish Gray": "72",
  "Medium Blue": "73",
  "Metallic Silver": "80",
  "Metallic Gold": "82",
  "Flat Silver": "179",
  "Trans Orange": "182",
  "Dark Blue": "272",
  "Pearl Gold": "297",
  "Dark Orange": "484",
  "Any Color": "9999",
};

const REFERENCE_COLOR = "Blue";

function json(body, status = 200, cacheSeconds = 86400) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
    },
  });
}

function extractImageUrl(data) {
  if (!data) return "";
  if (typeof data === "string") {
    const trimmed = data.trim();
    return /\.(png|jpe?g|webp)(\?.*)?$/i.test(trimmed) ? trimmed : "";
  }
  if (Array.isArray(data)) {
    for (const value of data) {
      const found = extractImageUrl(value);
      if (found) return found;
    }
    return "";
  }
  if (typeof data === "object") {
    const directKeys = [
      "part_img_url",
      "image_url",
      "img_url",
      "image",
      "image_link",
      "thumbnail_url",
      "small_image_url",
      "large_image_url",
    ];
    for (const key of directKeys) {
      const found = extractImageUrl(data[key]);
      if (found) return found;
    }
    for (const value of Object.values(data)) {
      const found = extractImageUrl(value);
      if (found) return found;
    }
  }
  return "";
}

function buildRebrickablePlan(part, requestedColor) {
  const exactColorId = COLOR_MAP[requestedColor] || "";
  const referenceColorId = COLOR_MAP[REFERENCE_COLOR] || "";
  const plan = [];

  if (exactColorId && exactColorId !== "9999") {
    plan.push({
      step: "exact_color",
      requestedColor,
      resolvedColor: requestedColor,
      isReference: false,
      source: "rebrickable",
      target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${encodeURIComponent(exactColorId)}/`,
    });
  }

  plan.push({
    step: "generic_part",
    requestedColor,
    resolvedColor: requestedColor,
    isReference: true,
    source: "rebrickable",
    target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/`,
  });

  if (referenceColorId && requestedColor !== REFERENCE_COLOR) {
    plan.push({
      step: requestedColor === "Any Color" ? "any_color_reference" : "blue_reference",
      requestedColor,
      resolvedColor: REFERENCE_COLOR,
      isReference: true,
      source: "rebrickable",
      target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${encodeURIComponent(referenceColorId)}/`,
    });
  }

  return plan;
}

async function fetchJson(target, options = {}) {
  const resp = await fetch(target, options);
  if (!resp.ok) {
    return { ok: false, status: resp.status, data: null };
  }
  return { ok: true, status: resp.status, data: await resp.json() };
}

async function tryBrickOwl(part, token) {
  const idLookupUrl = new URL("https://api.brickowl.com/v1/catalog/id_lookup");
  idLookupUrl.searchParams.set("key", token);
  idLookupUrl.searchParams.set("id", part);
  idLookupUrl.searchParams.set("type", "Part");
  idLookupUrl.searchParams.set("id_type", "item_no");

  const idLookup = await fetchJson(idLookupUrl.toString());
  if (!idLookup.ok) {
    return { ok: false, stage: "brickowl_id_lookup", status: idLookup.status, imageUrl: "" };
  }

  const boids = idLookup.data?.boids || [];
  if (!Array.isArray(boids) || !boids.length) {
    return { ok: false, stage: "brickowl_id_lookup", status: 200, imageUrl: "" };
  }

  const lookupUrl = new URL("https://api.brickowl.com/v1/catalog/lookup");
  lookupUrl.searchParams.set("key", token);
  lookupUrl.searchParams.set("boid", String(boids[0]));

  const lookup = await fetchJson(lookupUrl.toString());
  if (!lookup.ok) {
    return { ok: false, stage: "brickowl_lookup", status: lookup.status, imageUrl: "" };
  }

  const imageUrl = extractImageUrl(lookup.data);
  return {
    ok: !!imageUrl,
    stage: "brickowl_lookup",
    status: 200,
    imageUrl,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const part = (url.searchParams.get("part") || "").trim();
  const color = (url.searchParams.get("color") || "").trim();
  const debug = url.searchParams.get("debug") === "1";

  if (!part) {
    return json({ error: "Missing part" }, 400, 60);
  }

  const rebrickableApiKey = env.REBRICKABLE_API_KEY;
  if (!rebrickableApiKey) {
    return json({ error: "Missing REBRICKABLE_API_KEY" }, 500, 60);
  }

  const brickOwlApiToken = env.BRICKOWL_API_TOKEN || "";
  const rebrickableHeaders = { Authorization: `key ${rebrickableApiKey}` };
  const attempts = [];
  const plan = buildRebrickablePlan(part, color);

  for (const attempt of plan) {
    try {
      const result = await fetchJson(attempt.target, { headers: rebrickableHeaders });
      const attemptInfo = {
        step: attempt.step,
        requestedColor: attempt.requestedColor,
        resolvedColor: attempt.resolvedColor,
        isReference: attempt.isReference,
        source: attempt.source,
        target: attempt.target,
        status: result.status,
      };

      if (!result.ok) {
        attempts.push({ ...attemptInfo, result: "http_error" });
        continue;
      }

      const imageUrl = extractImageUrl(result.data);
      if (imageUrl) {
        attempts.push({ ...attemptInfo, result: "hit", imageUrl });
        return json({
          imageUrl,
          resolvedColor: attempt.resolvedColor,
          isReference: attempt.isReference,
          sourceStep: attempt.step,
          source: attempt.source,
          ...(debug ? { debug: { part, requestedColor: color, attempts } } : {}),
        }, 200, 86400);
      }

      attempts.push({ ...attemptInfo, result: "no_image_field" });
    } catch (error) {
      attempts.push({
        step: attempt.step,
        requestedColor: attempt.requestedColor,
        resolvedColor: attempt.resolvedColor,
        isReference: attempt.isReference,
        source: attempt.source,
        target: attempt.target,
        result: "fetch_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (brickOwlApiToken) {
    try {
      const brickOwl = await tryBrickOwl(part, brickOwlApiToken);
      attempts.push({
        step: brickOwl.stage,
        requestedColor: color,
        resolvedColor: REFERENCE_COLOR,
        isReference: true,
        source: "brickowl",
        status: brickOwl.status,
        result: brickOwl.ok ? "hit" : "no_image_field",
        ...(brickOwl.imageUrl ? { imageUrl: brickOwl.imageUrl } : {}),
      });
      if (brickOwl.ok) {
        return json({
          imageUrl: brickOwl.imageUrl,
          resolvedColor: REFERENCE_COLOR,
          isReference: true,
          sourceStep: "brickowl_reference",
          source: "brickowl",
          ...(debug ? { debug: { part, requestedColor: color, attempts } } : {}),
        }, 200, 86400);
      }
    } catch (error) {
      attempts.push({
        step: "brickowl_reference",
        requestedColor: color,
        resolvedColor: REFERENCE_COLOR,
        isReference: true,
        source: "brickowl",
        result: "fetch_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return json({
    imageUrl: "",
    resolvedColor: color || "",
    isReference: false,
    sourceStep: null,
    source: null,
    ...(debug ? { debug: { part, requestedColor: color, attempts } } : {}),
  }, 200, 3600);
}
