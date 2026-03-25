export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const part = (url.searchParams.get("part") || "").trim();
  const color = (url.searchParams.get("color") || "").trim();

  if (!part) {
    return new Response(JSON.stringify({ error: "Missing part" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = env.REBRICKABLE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing REBRICKABLE_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  const colorId = colorMap[color] || "";
  const headers = { Authorization: `key ${apiKey}` };

  const targets = [];
  if (colorId && colorId !== "9999") {
    targets.push(`https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/colors/${encodeURIComponent(colorId)}/`);
  }
  targets.push(`https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(part)}/`);

  for (const target of targets) {
    try {
      const resp = await fetch(target, { headers });
      if (!resp.ok) continue;

      const data = await resp.json();
      const imageUrl = data?.part_img_url || data?.part?.part_img_url || "";

      if (imageUrl) {
        return new Response(JSON.stringify({ imageUrl }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    } catch {
      // try next target
    }
  }

  return new Response(JSON.stringify({ imageUrl: "" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
