export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id || !/^\d+$/.test(id)) {
    return new Response("Missing or invalid book id", { status: 400 });
  }

  // Try common Gutenberg plain-text URL patterns in order
  const urls = [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/files/${id}/${id}.txt`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow" });
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
