// Run: node scripts/fetch-books.js
// Downloads a curated shelf of Gutenberg books as static text files.

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BOOKS = [
  { id: 84,    slug: "frankenstein",          title: "Frankenstein",                              author: "Mary Shelley" },
  { id: 1342,  slug: "pride-and-prejudice",   title: "Pride and Prejudice",                      author: "Jane Austen" },
  { id: 11,    slug: "alice-in-wonderland",    title: "Alice's Adventures in Wonderland",          author: "Lewis Carroll" },
  { id: 1661,  slug: "sherlock-holmes",        title: "The Adventures of Sherlock Holmes",         author: "Arthur Conan Doyle" },
  { id: 174,   slug: "picture-of-dorian-gray", title: "The Picture of Dorian Gray",               author: "Oscar Wilde" },
  { id: 1232,  slug: "the-prince",            title: "The Prince",                                author: "Niccolo Machiavelli" },
  { id: 98,    slug: "tale-of-two-cities",    title: "A Tale of Two Cities",                      author: "Charles Dickens" },
  { id: 1080,  slug: "modest-proposal",       title: "A Modest Proposal",                         author: "Jonathan Swift" },
  { id: 74,    slug: "tom-sawyer",            title: "The Adventures of Tom Sawyer",               author: "Mark Twain" },
  { id: 2701,  slug: "moby-dick",             title: "Moby Dick",                                 author: "Herman Melville" },
  { id: 345,   slug: "dracula",               title: "Dracula",                                   author: "Bram Stoker" },
  { id: 1400,  slug: "great-expectations",    title: "Great Expectations",                        author: "Charles Dickens" },
  { id: 76,    slug: "huckleberry-finn",      title: "Adventures of Huckleberry Finn",            author: "Mark Twain" },
  { id: 2591,  slug: "grimms-fairy-tales",    title: "Grimms' Fairy Tales",                       author: "Brothers Grimm" },
  { id: 16328, slug: "beowulf",               title: "Beowulf",                                   author: "Unknown" },
];

function stripBoilerplate(raw) {
  let start = raw.indexOf("*** START OF THE PROJECT GUTENBERG EBOOK");
  if (start === -1) start = raw.indexOf("*** START OF THIS PROJECT GUTENBERG EBOOK");
  if (start !== -1) {
    const nl = raw.indexOf("\n", start);
    raw = raw.slice(nl + 1);
  }
  let end = raw.indexOf("*** END OF THE PROJECT GUTENBERG EBOOK");
  if (end === -1) end = raw.indexOf("*** END OF THIS PROJECT GUTENBERG EBOOK");
  if (end !== -1) raw = raw.slice(0, end);
  return raw.trim();
}

const outDir = join(process.cwd(), "public", "books");
mkdirSync(outDir, { recursive: true });

const manifest = [];

for (const book of BOOKS) {
  const urls = [
    `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.txt`,
    `https://www.gutenberg.org/files/${book.id}/${book.id}-0.txt`,
  ];

  let text = null;
  for (const url of urls) {
    try {
      console.log(`  trying ${url}...`);
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) {
        text = await res.text();
        break;
      }
    } catch {}
  }

  if (!text) {
    console.error(`  FAILED: ${book.title}`);
    continue;
  }

  const cleaned = stripBoilerplate(text);
  const filename = `${book.slug}.txt`;
  writeFileSync(join(outDir, filename), cleaned, "utf-8");

  const wordCount = cleaned.split(/\s+/).length;
  manifest.push({ ...book, filename, wordCount });
  console.log(`  OK: ${book.title} (${wordCount} words)`);
}

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf-8"
);

console.log(`\nDone — ${manifest.length} books in public/books/`);
