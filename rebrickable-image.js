export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const part = (url.searchParams.get("part") || "").trim();
  const color = (url.searchParams.get("color") || "").trim();
  const debug = url.searchParams.get("debug") === "1";

  if (!part) {
    return new Response(JSON.stringify({ error: "Missing part" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rebrickableApiKey = env.REBRICKABLE_API_KEY;
  if (!rebrickableApiKey) {
    return new Response(JSON.stringify({ error: "Missing REBRICKABLE_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const brickOwlApiToken = env.BRICKOWL_API_TOKEN || "";

  const colorMap = {
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

  const requestedColorId = colorMap[color] || "";
  const blueColorId = colorMap.Blue;
  const rebrickableHeaders = { Authorization: `key ${rebrickableApiKey}` };
  const attempts = [];

  function makeResponse(payload, maxAge) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${maxAge}`,
      },
    });
  }

  async function fetchJson(target, options = {}) {
    const resp = await fetch(target, options);
    if (!resp.ok) return null;
    return await resp.json();
  }

  function extractImageUrl(value) {
    if (!value) return "";

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      if (/\.(png|jpe?g|webp)(\?.*)?$/i.test(trimmed)) return trimmed;
      return "";
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = extractImageUrl(entry);
        if (found) return found;
      }
      return "";
    }

    if (typeof value === "object") {
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
        const found = extractImageUrl(value[key]);
        if (found) return found;
      }
      for (const nestedValue of Object.values(value)) {
        const found = extractImageUrl(nestedValue);
        if (found) return found;
      }
    }

    return "";
  }

  async function tryRebrickableTarget(target, resolvedFrom, label) {
    attempts.push(label);
    try {
      const data = await fetchJson(target, { headers: rebrickableHeaders });
      if (!data) return null;
      const imageUrl = extractImageUrl(data);
      if (!imageUrl) return null;
      return { imageUrl, resolvedFrom, source: "rebrickable" };
    } catch {
      return null;
    }
  }

  async function tryBrickOwlLookup(label) {
    if (!brickOwlApiToken) return null;

    attempts.push(label);
    try {
      const idLookupUrl = new URL("https://api.brickowl.com/v1/catalog/id_lookup");
      idLookupUrl.searchParams.set("key", brickOwlApiToken);
      idLookupUrl.searchParams.set("id", part);
      idLookupUrl.searchParams.set("type", "Part");
      idLookupUrl.searchParams.set("id_type", "item_no");

      const idLookupData = await fetchJson(idLookupUrl.toString());
      const boids = idLookupData?.boids || [];
      if (!Array.isArray(boids) || !boids.length) return null;

      const lookupUrl = new URL("https://api.brickowl.com/v1/catalog/lookup");
      lookupUrl.searchParams.set("key", brickOwlApiToken);
      lookupUrl.searchParams.set("boid", String(boids[0]));

      const lookupData = await fetchJson(lookupUrl.toString());
      const imageUrl = extractImageUrl(lookupData);
      if (!imageUrl) return null;

      return {
        imageUrl,
        resolvedFrom: "brickowl_ref",
        source: "brickowl",
      };
    } catch {
      return null;
    }
  }

  const targets = [];
  if (requestedColorId && requestedColorId !== "9999") {
    targets.push({
      target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${encodeURIComponent(requestedColorId)}/`,
      resolvedFrom: "exact",
      label: `rebrickable_exact:${requestedColorId}`,
    });
  }

  targets.push({
    target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/`,
    resolvedFrom: "part_ref",
    label: "rebrickable_part_ref",
  });

  if (blueColorId && requestedColorId !== blueColorId) {
    targets.push({
      target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${encodeURIComponent(blueColorId)}/`,
      resolvedFrom: "blue_ref",
      label: `rebrickable_blue_ref:${blueColorId}`,
    });
  }

  for (const entry of targets) {
    const result = await tryRebrickableTarget(entry.target, entry.resolvedFrom, entry.label);
    if (result) {
      return makeResponse({
        imageUrl: result.imageUrl,
        resolvedFrom: result.resolvedFrom,
        source: result.source,
        ...(debug ? {
          debug: {
            part,
            requestedColor: color,
            attempts,
            resolvedFrom: result.resolvedFrom,
            source: result.source,
          }
        } : {})
      }, 86400);
    }
  }

  const brickOwlResult = await tryBrickOwlLookup("brickowl_lookup");
  if (brickOwlResult) {
    return makeResponse({
      imageUrl: brickOwlResult.imageUrl,
      resolvedFrom: brickOwlResult.resolvedFrom,
      source: brickOwlResult.source,
      ...(debug ? {
        debug: {
          part,
          requestedColor: color,
          attempts,
          resolvedFrom: brickOwlResult.resolvedFrom,
          source: brickOwlResult.source,
        }
      } : {})
    }, 86400);
  }

  return makeResponse({
    imageUrl: "",
    resolvedFrom: null,
    source: null,
    ...(debug ? {
      debug: {
        part,
        requestedColor: color,
        attempts,
        resolvedFrom: null,
        source: null,
      }
    } : {})
  }, 3600);
}
