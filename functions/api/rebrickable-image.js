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
  return data?.part_img_url || data?.part?.part_img_url || "";
}

function buildAttemptPlan(part, requestedColor) {
  const exactColorId = COLOR_MAP[requestedColor] || "";
  const referenceColorId = COLOR_MAP[REFERENCE_COLOR] || "";
  const plan = [];

  if (exactColorId && exactColorId !== "9999") {
    plan.push({
      step: "exact_color",
      requestedColor,
      resolvedColor: requestedColor,
      isReference: false,
      target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${encodeURIComponent(exactColorId)}/`,
    });
  }

  if (requestedColor === "Any Color") {
    if (referenceColorId) {
      plan.push({
        step: "any_color_reference",
        requestedColor,
        resolvedColor: REFERENCE_COLOR,
        isReference: true,
        target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${encodeURIComponent(referenceColorId)}/`,
      });
    }
  } else if (requestedColor !== REFERENCE_COLOR && referenceColorId) {
    plan.push({
      step: "blue_reference",
      requestedColor,
      resolvedColor: REFERENCE_COLOR,
      isReference: true,
      target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${encodeURIComponent(referenceColorId)}/`,
    });
  }

  plan.push({
    step: "generic_part",
    requestedColor,
    resolvedColor: requestedColor,
    isReference: requestedColor !== REFERENCE_COLOR,
    target: `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/`,
  });

  return plan;
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

  const apiKey = env.REBRICKABLE_API_KEY;
  if (!apiKey) {
    return json({ error: "Missing REBRICKABLE_API_KEY" }, 500, 60);
  }

  const headers = { Authorization: `key ${apiKey}` };
  const attempts = [];
  const plan = buildAttemptPlan(part, color);

  for (const attempt of plan) {
    try {
      const resp = await fetch(attempt.target, { headers });
      const attemptInfo = {
        step: attempt.step,
        requestedColor: attempt.requestedColor,
        resolvedColor: attempt.resolvedColor,
        isReference: attempt.isReference,
        target: attempt.target,
        status: resp.status,
      };

      if (!resp.ok) {
        attempts.push({ ...attemptInfo, result: "http_error" });
        continue;
      }

      const data = await resp.json();
      const imageUrl = extractImageUrl(data);
      if (imageUrl) {
        attempts.push({ ...attemptInfo, result: "hit", imageUrl });
        return json({
          imageUrl,
          resolvedColor: attempt.resolvedColor,
          isReference: attempt.isReference,
          sourceStep: attempt.step,
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
        target: attempt.target,
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
    ...(debug ? { debug: { part, requestedColor: color, attempts } } : {}),
  }, 200, 3600);
}
