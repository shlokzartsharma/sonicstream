export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const search = searchParams.get("search");

  // ── Search mode ──
  if (search) {
    try {
      const res = await fetch(
        `https://gutendex.com/books/?search=${encodeURIComponent(search)}&languages=en`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return new Response("Gutendex error", { status: 502 });
      const data = await res.json();
      return Response.json(data);
    } catch {
      return new Response("Search request failed", { status: 502 });
    }
  }

  // ── Book text mode ──
  if (!id || !/^\d+$/.test(id)) {
    return new Response("Provide ?search= or ?id=", { status: 400 });
  }

  const urls = [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/files/${id}/${id}.txt`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const text = await res.text();
        return new Response(text, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    } catch {
      // try next URL
    }
  }

  return new Response("Book text not found", { status: 404 });
}
