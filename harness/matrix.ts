export interface Task {
  id: string;
  framework: string;
  complexity: "trivial" | "simple" | "standard";
  description: string;
}

// 100 tasks across 13 frameworks × 3 complexity levels
export const MATRIX: Task[] = [
  // === BATCH 1 (1-5) ===
  { id: "static-t-01", framework: "static-html", complexity: "trivial", description: "A single index.html with inline CSS showing a landing page for a fictional coffee shop. Hero section, menu items, footer." },
  { id: "bun-t-02", framework: "bun", complexity: "trivial", description: "A single-file Bun.serve() API: GET / returns { status: 'ok' }, GET /time returns ISO timestamp, GET /echo?msg=X echoes the param." },
  { id: "node-t-03", framework: "node", complexity: "trivial", description: "A single index.js file using Node http module. GET / returns JSON greeting, GET /health returns { healthy: true }. Include package.json." },
  { id: "python-t-04", framework: "python", complexity: "trivial", description: "A single main.py using Flask. GET / returns 'Hello World'. Include requirements.txt with flask. Include a Dockerfile using python:3.12-slim, install deps, expose port 3000, run with flask run --host=0.0.0.0 --port=3000." },
  { id: "go-t-05", framework: "go", complexity: "trivial", description: "A single main.go using net/http. GET / returns JSON greeting, GET /health returns healthy. Include go.mod. Include a Dockerfile using golang:1.22-alpine to build, then deploy from alpine with the binary. Expose port 3000." },

  // === BATCH 2 (6-10) ===
  { id: "static-s-06", framework: "static-html", complexity: "simple", description: "A 3-page portfolio site: index.html, projects.html, contact.html. Shared style.css file. Nav links between pages. Clean modern design." },
  { id: "bun-s-07", framework: "bun", complexity: "simple", description: "A Bun.serve() URL shortener. POST /shorten accepts { url } returns { code, shortUrl }. GET /:code redirects. GET /stats returns total links. In-memory storage." },
  { id: "node-s-08", framework: "node", complexity: "simple", description: "An Express.js todo API. GET /todos, POST /todos { title }, PATCH /todos/:id { done }, DELETE /todos/:id. In-memory array. Include package.json with express." },
  { id: "python-s-09", framework: "python", complexity: "simple", description: "A FastAPI app: GET / welcome, GET /random returns random number 1-100, POST /calculate accepts { a, b, op } returns result. Include requirements.txt with fastapi and uvicorn. Dockerfile using python:3.12-slim, expose 3000, CMD uvicorn main:app --host 0.0.0.0 --port 3000." },
  { id: "go-s-10", framework: "go", complexity: "simple", description: "A Go net/http JSON API: GET /api/quotes returns 5 hardcoded quotes, GET /api/quotes/random returns one random quote, GET /health. Include go.mod. Dockerfile with multi-stage build, expose 3000." },

  // === BATCH 3 (11-15) ===
  { id: "bun-s-11", framework: "bun", complexity: "simple", description: "A Bun.serve() markdown-to-HTML API. POST /render accepts { markdown } and returns { html }. GET / serves a simple HTML form where you type markdown and see the preview. No external deps — hand-parse bold, italic, headers, links." },
  { id: "static-s-12", framework: "static-html", complexity: "simple", description: "A CSS-only animated landing page. Single index.html with a hero banner, floating particles (CSS keyframes), a features grid, and a CTA button. All done with HTML + CSS, no JS." },
  { id: "rust-t-13", framework: "rust", complexity: "trivial", description: "A minimal Rust HTTP server using actix-web. GET / returns JSON { message: 'hello from rust' }. Include Cargo.toml. Dockerfile: use rust:1.78-slim to build, copy binary to debian:bookworm-slim. Expose 3000." },
  { id: "ruby-t-14", framework: "ruby", complexity: "trivial", description: "A Sinatra app: GET / returns JSON greeting, GET /time returns current time. Include Gemfile with sinatra and puma. Dockerfile using ruby:3.3-slim, bundle install, expose 3000, CMD bundle exec puma -p 3000." },
  { id: "bun-t-15", framework: "bun", complexity: "trivial", description: "A Bun.serve() server that generates random SVG art. GET / returns an HTML page, GET /art returns a random SVG with circles and lines. Different colors each time." },

  // === BATCH 4 (16-20) ===
  { id: "static-t-16", framework: "static-html", complexity: "trivial", description: "A single-page clock app. index.html with JS that shows an analog clock using Canvas API. Auto-updates every second. Dark theme." },
  { id: "bun-s-17", framework: "bun", complexity: "simple", description: "A Bun.serve() paste bin. POST /paste accepts { content } returns { id, url }. GET /paste/:id returns the content. GET / shows an HTML form. In-memory storage. Max 100 pastes." },
  { id: "node-s-18", framework: "node", complexity: "simple", description: "A Node.js Express weather mock API. GET /weather/:city returns fake weather data (temp, conditions, humidity) seeded by city name so it's deterministic. GET /cities returns list of supported cities." },
  { id: "python-s-19", framework: "python", complexity: "simple", description: "A Flask bookmark manager API. GET /bookmarks, POST /bookmarks { url, title, tags }, DELETE /bookmarks/:id, GET /bookmarks/search?tag=X. In-memory storage. Dockerfile with python:3.12-slim, expose 3000." },
  { id: "go-s-20", framework: "go", complexity: "simple", description: "A Go key-value store API. PUT /kv/:key with body as value, GET /kv/:key returns value, DELETE /kv/:key, GET /kv lists all keys. In-memory map with mutex. Dockerfile multi-stage, expose 3000." },

  // === BATCH 5 (21-25) ===
  { id: "bun-std-21", framework: "bun", complexity: "standard", description: "A Bun.serve() app with HTML frontend import. API routes: GET /api/notes, POST /api/notes, DELETE /api/notes/:id. index.html imports frontend.tsx (React) for a notes UI. Include package.json with react, react-dom." },
  { id: "static-std-22", framework: "static-html", complexity: "standard", description: "A D3.js data visualization dashboard. 3 HTML files: bar chart, pie chart, line chart. Shared data.json with sample sales data. D3 loaded from CDN. Responsive layout." },
  { id: "node-std-23", framework: "node", complexity: "standard", description: "An Express.js blog API with file-based storage. GET /posts, GET /posts/:slug, POST /posts { title, body }, PUT /posts/:slug. Stores posts as JSON files in a data/ directory. Includes markdown rendering." },
  { id: "python-std-24", framework: "python", complexity: "standard", description: "A FastAPI app with SQLite database. CRUD for /items. Includes pydantic models, database init on startup, proper error handling. Dockerfile with python:3.12-slim, expose 3000." },
  { id: "bun-s-25", framework: "bun", complexity: "simple", description: "A Bun.serve() WebSocket chat server. GET / serves an HTML page with chat UI. WebSocket at /ws broadcasts messages to all connected clients. Shows connected count." },

  // === BATCH 6 (26-30) ===
  { id: "static-t-26", framework: "static-html", complexity: "trivial", description: "A CSS grid photo gallery. Single index.html with 12 placeholder colored divs arranged in a masonry-like CSS grid layout. Hover effects, responsive." },
  { id: "bun-t-27", framework: "bun", complexity: "trivial", description: "A Bun.serve() dice roller API. GET / returns HTML with a roll button. GET /roll returns { dice: [d1, d2], total }. GET /roll/:n rolls n dice." },
  { id: "ruby-s-28", framework: "ruby", complexity: "simple", description: "A Sinatra REST API for a reading list. GET /books, POST /books { title, author }, PATCH /books/:id { status }, DELETE /books/:id. In-memory storage. Gemfile with sinatra, puma, json. Dockerfile using ruby:3.3-slim, expose 3000." },
  { id: "rust-s-29", framework: "rust", complexity: "simple", description: "An Actix-web API: GET /api/words returns list of random words, GET /api/words/:count returns N random words, GET /health. Hardcoded word list. Cargo.toml with actix-web and serde. Dockerfile multi-stage with rust:1.78-slim builder, debian:bookworm-slim runtime, expose 3000." },
  { id: "node-t-30", framework: "node", complexity: "trivial", description: "A single index.js Node http server that serves a JSON API. GET / returns { name: 'node-api', version: '1.0.0' }, GET /env returns { nodeVersion, platform, uptime }. Include package.json." },

  // === BATCH 7 (31-35) ===
  { id: "bun-s-31", framework: "bun", complexity: "simple", description: "A Bun.serve() image placeholder service. GET /img/:width/:height returns an SVG image of that size with the dimensions as text. GET /img/:width/:height/:color allows custom background color. GET / shows usage docs as HTML." },
  { id: "python-t-32", framework: "python", complexity: "trivial", description: "A single main.py Flask app: GET / returns JSON with a random motivational quote from a hardcoded list of 20. GET /health returns ok. Include requirements.txt and Dockerfile with python:3.12-slim, expose 3000." },
  { id: "go-std-33", framework: "go", complexity: "standard", description: "A Go HTTP server with file upload. POST /upload accepts multipart file, stores in /tmp/uploads/. GET /files lists uploads. GET /files/:name serves the file. GET / shows HTML upload form. Dockerfile multi-stage, expose 3000." },
  { id: "static-s-34", framework: "static-html", complexity: "simple", description: "An interactive periodic table. index.html with CSS grid of element symbols. Click an element to see details in a sidebar. All data inline in a JS object. style.css for the grid." },
  { id: "bun-t-35", framework: "bun", complexity: "trivial", description: "A Bun.serve() server that returns the request info. GET / returns { method, url, headers, timestamp } as formatted JSON. GET /ip returns the client IP." },

  // === BATCH 8 (36-40) ===
  { id: "node-s-36", framework: "node", complexity: "simple", description: "An Express.js URL health checker API. POST /check accepts { urls: string[] }, fetches each URL, returns status codes and response times. GET /history returns last 50 checks. Include package.json with express." },
  { id: "bun-std-37", framework: "bun", complexity: "standard", description: "A Bun.serve() link-in-bio page builder. GET /api/pages/:slug returns page data. POST /api/pages creates a page { name, bio, links[] }. GET /:slug renders the page as HTML. Include a simple admin form at GET /admin." },
  { id: "python-s-38", framework: "python", complexity: "simple", description: "A Flask unit converter API. GET /convert?from=km&to=miles&value=5 returns converted value. Supports length, weight, temperature. GET /units lists all supported conversions. Dockerfile with python:3.12-slim, expose 3000." },
  { id: "static-std-39", framework: "static-html", complexity: "standard", description: "A Tailwind CSS (from CDN) dashboard template. 4 HTML files: overview with stat cards, a data table page, a form page, and a settings page. Sidebar nav. Responsive." },
  { id: "go-t-40", framework: "go", complexity: "trivial", description: "A Go HTTP server that serves a JSON API with system info. GET / returns { os, arch, goVersion, numCPU, uptime }. GET /health returns ok. Include go.mod. Dockerfile multi-stage alpine, expose 3000." },

  // === BATCH 9 (41-45) ===
  { id: "bun-s-41", framework: "bun", complexity: "simple", description: "A Bun.serve() color palette API. GET /palette returns 5 random hex colors. GET /palette/:seed returns deterministic colors from seed. GET / shows HTML page displaying the palette visually." },
  { id: "ruby-std-42", framework: "ruby", complexity: "standard", description: "A Sinatra app with SQLite. CRUD API for /contacts { name, email, phone }. Includes DB migration on startup, proper error responses. Gemfile with sinatra, puma, sqlite3, sequel. Dockerfile with ruby:3.3-slim, expose 3000." },
  { id: "node-std-43", framework: "node", complexity: "standard", description: "An Express.js app with EJS templating. Server-rendered pages: home, about, contact form that POSTs and shows a thank you page. Include package.json with express and ejs. Views in views/ dir." },
  { id: "bun-t-44", framework: "bun", complexity: "trivial", description: "A Bun.serve() server that acts as a JSON formatter. POST /format accepts raw JSON string body, returns it pretty-printed. POST /minify does the opposite. GET / serves an HTML textarea form." },
  { id: "python-std-45", framework: "python", complexity: "standard", description: "A FastAPI task queue simulator. POST /tasks creates a task that 'processes' for 2-5 seconds. GET /tasks/:id returns status (pending/processing/done). GET /tasks lists all. Uses background threads. Dockerfile python:3.12-slim, expose 3000." },

  // === BATCH 10 (46-50) ===
  { id: "static-t-46", framework: "static-html", complexity: "trivial", description: "A single-page typing speed test. index.html with a paragraph of text, input field, and WPM counter using vanilla JS. Shows accuracy percentage." },
  { id: "bun-s-47", framework: "bun", complexity: "simple", description: "A Bun.serve() emoji API. GET /emoji/random returns a random emoji with name. GET /emoji/search?q=smile returns matching emojis. GET /emoji/category/:cat returns emojis by category. Hardcoded dataset of 50 emojis." },
  { id: "go-s-48", framework: "go", complexity: "simple", description: "A Go HTTP server that generates QR-code-like SVG patterns. GET /qr?data=hello returns an SVG grid pattern derived from the input string hash. GET / shows an HTML form. Include go.mod, Dockerfile multi-stage, expose 3000." },
  { id: "node-t-49", framework: "node", complexity: "trivial", description: "A Node http server that serves a math API. GET /add?a=1&b=2 returns { result: 3 }. Same for /subtract, /multiply, /divide. GET / returns available operations. Include package.json." },
  { id: "bun-std-50", framework: "bun", complexity: "standard", description: "A Bun.serve() poll/voting app. POST /api/polls creates { question, options[] }. POST /api/polls/:id/vote { option }. GET /api/polls/:id returns results with counts. GET / serves HTML with React frontend for creating and voting." },

  // === BATCH 11 (51-55) ===
  { id: "python-t-51", framework: "python", complexity: "trivial", description: "A Flask ASCII art API. GET / returns a random ASCII art animal. GET /art/:name returns specific animal (cat, dog, fish, owl, rabbit). Plain text responses. Dockerfile python:3.12-slim, expose 3000." },
  { id: "bun-s-52", framework: "bun", complexity: "simple", description: "A Bun.serve() feature flag service. POST /flags creates { name, enabled }. GET /flags returns all flags. GET /flags/:name returns the flag. PATCH /flags/:name toggles it. GET /evaluate?flags=a,b,c returns which are enabled." },
  { id: "static-s-53", framework: "static-html", complexity: "simple", description: "A CSS animation showcase. 5 HTML pages each showing a different CSS animation: spinner, pulse, slide-in, bounce, morphing shapes. Index page links to all. Shared style.css." },
  { id: "go-std-54", framework: "go", complexity: "standard", description: "A Go URL shortener with BoltDB storage. POST /shorten { url }, GET /:code redirects, GET /stats/:code returns click count. Persists across restarts. Dockerfile multi-stage with golang:1.22-alpine, expose 3000. Include go.mod with bbolt dependency." },
  { id: "node-s-55", framework: "node", complexity: "simple", description: "An Express.js rate limiter demo. All routes rate-limited to 10 req/min per IP. GET / shows current limit status. GET /api/data returns mock data. Returns 429 when exceeded. In-memory tracking. Package.json with express." },

  // === BATCH 12 (56-60) ===
  { id: "bun-t-56", framework: "bun", complexity: "trivial", description: "A Bun.serve() server that returns lorem ipsum. GET /paragraphs/:n returns n paragraphs. GET /words/:n returns n words. GET /sentences/:n returns n sentences. All generated from a hardcoded word list." },
  { id: "rust-std-57", framework: "rust", complexity: "standard", description: "An Actix-web app with a key-value store using sled embedded DB. PUT /kv/:key, GET /kv/:key, DELETE /kv/:key, GET /kv/list. Cargo.toml with actix-web, serde, sled. Dockerfile multi-stage rust:1.78-slim to debian:bookworm-slim, expose 3000." },
  { id: "python-s-58", framework: "python", complexity: "simple", description: "A Flask password generator API. GET /generate returns a random password. GET /generate?length=20&symbols=true&numbers=true for customization. POST /check { password } returns strength score. Dockerfile python:3.12-slim, expose 3000." },
  { id: "static-std-59", framework: "static-html", complexity: "standard", description: "A vanilla JS kanban board. Single HTML file with drag-and-drop columns (Todo, In Progress, Done). Cards can be created, moved, deleted. Data persists in localStorage. CSS grid layout." },
  { id: "bun-s-60", framework: "bun", complexity: "simple", description: "A Bun.serve() mock REST API generator. GET /api/:resource returns a list of 10 fake items. GET /api/:resource/:id returns one item. Generates consistent fake data based on the resource name (users, products, posts, etc)." },

  // === BATCH 13 (61-65) ===
  { id: "node-std-61", framework: "node", complexity: "standard", description: "An Express.js app with WebSocket (ws library). Chat rooms: POST /rooms creates a room. GET /rooms lists rooms. WebSocket at /ws/:room for real-time chat. GET / serves HTML chat client. Package.json with express and ws." },
  { id: "bun-t-62", framework: "bun", complexity: "trivial", description: "A Bun.serve() HTTP status code reference. GET /:code returns the status code name and description as JSON. GET / returns all codes grouped by category (1xx, 2xx, etc). Hardcoded data." },
  { id: "go-s-63", framework: "go", complexity: "simple", description: "A Go HTTP server that acts as a cron expression parser. POST /parse { expression } returns { next5: [...dates] }. GET /presets returns common cron expressions. Implement basic cron parsing (no external deps). Dockerfile multi-stage, expose 3000." },
  { id: "python-std-64", framework: "python", complexity: "standard", description: "A FastAPI markdown wiki. GET /pages lists all pages. GET /pages/:slug returns rendered HTML. POST /pages { slug, content } creates/updates. Stores as .md files in a data/ dir. Basic nav template. Dockerfile python:3.12-slim, expose 3000." },
  { id: "static-t-65", framework: "static-html", complexity: "trivial", description: "A CSS-only loading animation collection. Single index.html with 8 different pure-CSS loading spinners/animations. No JavaScript. Grid layout showing all animations." },

  // === BATCH 14 (66-70) ===
  { id: "bun-s-66", framework: "bun", complexity: "simple", description: "A Bun.serve() JWT-like token service (simplified, not real JWT). POST /token { sub, exp } returns a base64-encoded token. POST /verify { token } returns decoded payload or error. GET / shows docs." },
  { id: "ruby-s-67", framework: "ruby", complexity: "simple", description: "A Sinatra API for a simple key-value config store. GET /config returns all. GET /config/:key returns value. PUT /config/:key sets value. DELETE /config/:key removes. YAML-like response format. Gemfile with sinatra, puma. Dockerfile ruby:3.3-slim, expose 3000." },
  { id: "node-s-68", framework: "node", complexity: "simple", description: "An Express.js mock notification API. POST /notify { channel, message, level }. GET /notifications returns last 100. GET /notifications/stats returns counts by level (info/warn/error). In-memory. Package.json with express." },
  { id: "bun-std-69", framework: "bun", complexity: "standard", description: "A Bun.serve() app with SQLite (bun:sqlite). A habit tracker: POST /api/habits, GET /api/habits, POST /api/habits/:id/check-in, GET /api/habits/:id/streak. GET / serves HTML+React frontend showing habits and streaks." },
  { id: "python-t-70", framework: "python", complexity: "trivial", description: "A Flask color API. GET / returns a random hex color with RGB values. GET /color/:hex returns the RGB/HSL breakdown. GET /palette/:hex returns 5 complementary colors. Dockerfile python:3.12-slim, expose 3000." },

  // === BATCH 15 (71-75) ===
  { id: "static-s-71", framework: "static-html", complexity: "simple", description: "A recipe card collection. 3 HTML files each showing a recipe with ingredients, steps, and a photo placeholder. Shared recipe-card.css with a card-based design. Index page lists all recipes." },
  { id: "bun-t-72", framework: "bun", complexity: "trivial", description: "A Bun.serve() user agent parser. GET / with any User-Agent header returns parsed { browser, os, device } as JSON. GET /test serves an HTML page that shows your own parsed UA." },
  { id: "go-t-73", framework: "go", complexity: "trivial", description: "A Go HTTP server that generates maze-like SVG. GET /maze returns a random 10x10 maze as SVG. GET /maze/:size for custom size. GET / shows the maze in an HTML page with a refresh button. Dockerfile multi-stage, expose 3000." },
  { id: "node-std-74", framework: "node", complexity: "standard", description: "An Express.js cron job dashboard. POST /jobs { name, interval, url } registers a job. GET /jobs lists all. GET /jobs/:id/history shows last runs. Jobs don't actually run — just tracks scheduling. Package.json with express." },
  { id: "bun-s-75", framework: "bun", complexity: "simple", description: "A Bun.serve() IP geolocation mock. GET /lookup/:ip returns fake but deterministic { country, city, lat, lng } derived from the IP octets. GET /me returns info for the requester. GET / shows a map placeholder." },

  // === BATCH 16 (76-80) ===
  { id: "python-s-76", framework: "python", complexity: "simple", description: "A Flask text analysis API. POST /analyze { text } returns { wordCount, charCount, sentences, topWords, readingTime }. GET / shows an HTML form. Dockerfile python:3.12-slim, expose 3000." },
  { id: "bun-std-77", framework: "bun", complexity: "standard", description: "A Bun.serve() expense tracker. POST /api/expenses, GET /api/expenses, GET /api/expenses/summary (totals by category). GET / serves React frontend with a form and chart (CSS bar chart). Package.json with react, react-dom." },
  { id: "static-std-78", framework: "static-html", complexity: "standard", description: "A vanilla JS markdown editor. Single HTML file with a split view: textarea on left, rendered preview on right. Supports bold, italic, headers, links, code blocks. Live preview as you type. CSS for styling." },
  { id: "rust-t-79", framework: "rust", complexity: "trivial", description: "A minimal Axum web server. GET / returns JSON greeting. GET /health returns ok. Include Cargo.toml with axum, tokio, serde. Dockerfile: rust:1.78-slim to build, debian:bookworm-slim to run, expose 3000." },
  { id: "node-t-80", framework: "node", complexity: "trivial", description: "A Node http server that returns the current time in multiple formats. GET /unix returns epoch, GET /iso returns ISO string, GET /human returns readable string, GET / returns all formats. Package.json." },

  // === BATCH 17 (81-85) ===
  { id: "bun-t-81", framework: "bun", complexity: "trivial", description: "A Bun.serve() coin flip API. GET /flip returns { result: 'heads'|'tails' }. GET /flip/:n returns n flips with summary. GET / shows an HTML page with animated coin flip." },
  { id: "go-std-82", framework: "go", complexity: "standard", description: "A Go RSS feed aggregator API. POST /feeds { url } adds a feed. GET /feeds lists feeds. GET /feeds/:id/entries parses and returns entries (fetch the URL, parse XML). GET / shows HTML feed reader. Dockerfile multi-stage, expose 3000." },
  { id: "python-std-83", framework: "python", complexity: "standard", description: "A FastAPI file sharing service. POST /upload multipart file upload (max 1MB). GET /files lists uploads. GET /files/:id downloads the file. Files stored in /tmp/uploads/. Dockerfile python:3.12-slim with python-multipart, expose 3000." },
  { id: "static-t-84", framework: "static-html", complexity: "trivial", description: "A single-page color picker tool. index.html with an input type=color, shows hex/rgb/hsl values. Copy-to-clipboard button. Vanilla JS. Clean minimal design." },
  { id: "bun-s-85", framework: "bun", complexity: "simple", description: "A Bun.serve() redirect chain tester. POST /check { url } follows redirects and returns the chain: [{ url, status, location }...]. GET / shows an HTML form. Max 10 redirects." },

  // === BATCH 18 (86-90) ===
  { id: "node-s-86", framework: "node", complexity: "simple", description: "An Express.js CSV-to-JSON converter API. POST /convert accepts CSV text body, returns JSON array. POST /convert/json-to-csv does the reverse. GET / shows an HTML form with textarea. Package.json with express." },
  { id: "bun-std-87", framework: "bun", complexity: "standard", description: "A Bun.serve() URL bookmark manager with tags. POST /api/bookmarks { url, title, tags[] }. GET /api/bookmarks?tag=X filters by tag. GET /api/tags returns tag cloud. GET / serves React frontend. Package.json with react, react-dom." },
  { id: "ruby-t-88", framework: "ruby", complexity: "trivial", description: "A Sinatra app that returns random facts. GET / returns a random fun fact from a list of 30. GET /fact/:n returns fact number n. GET /count returns total facts. Gemfile with sinatra, puma. Dockerfile ruby:3.3-slim, expose 3000." },
  { id: "python-t-89", framework: "python", complexity: "trivial", description: "A Flask echo server. GET / returns all request headers as JSON. POST / returns the request body back. GET /ip returns client IP. Simple request introspection tool. Dockerfile python:3.12-slim, expose 3000." },
  { id: "go-s-90", framework: "go", complexity: "simple", description: "A Go HTTP server that generates placeholder avatar SVGs. GET /avatar/:name returns an SVG circle with initials derived from the name. GET /avatar/:name?size=200 for custom size. Deterministic colors from name hash. Dockerfile multi-stage, expose 3000." },

  // === BATCH 19 (91-95) ===
  { id: "bun-s-91", framework: "bun", complexity: "simple", description: "A Bun.serve() server that converts between data formats. POST /convert/json-to-yaml, POST /convert/yaml-to-json, POST /convert/json-to-toml. Hand-implement simple YAML/TOML serialization for flat objects. GET / shows docs." },
  { id: "static-s-92", framework: "static-html", complexity: "simple", description: "A CSS flexbox playground. Single HTML file with interactive controls (JS) to adjust flex properties (direction, wrap, justify, align) and see the result live on colored boxes. Educational tool." },
  { id: "node-std-93", framework: "node", complexity: "standard", description: "An Express.js API with basic auth middleware. POST /auth/login { username, password } returns a token. GET /api/me requires token in Authorization header. GET /api/data is protected. In-memory users. Package.json with express." },
  { id: "python-s-94", framework: "python", complexity: "simple", description: "A Flask Pomodoro timer API. POST /sessions/start creates a 25-min session. GET /sessions/:id returns time remaining. POST /sessions/:id/stop ends it. GET /sessions/stats returns completed count. Dockerfile python:3.12-slim, expose 3000." },
  { id: "bun-t-95", framework: "bun", complexity: "trivial", description: "A Bun.serve() base64 encoder/decoder. POST /encode accepts text, returns base64. POST /decode accepts base64, returns text. GET / shows an HTML form with both operations." },

  // === BATCH 20 (96-100) ===
  { id: "go-t-96", framework: "go", complexity: "trivial", description: "A Go HTTP server that returns fibonacci numbers. GET /fib/:n returns the nth fibonacci number. GET /fib/:n/sequence returns the sequence up to n. GET / shows docs. Dockerfile multi-stage alpine, expose 3000." },
  { id: "bun-std-97", framework: "bun", complexity: "standard", description: "A Bun.serve() mini analytics tracker. POST /api/track { event, properties }. GET /api/events returns last 1000 events. GET /api/events/summary groups by event name with counts. GET / serves React dashboard. Package.json with react, react-dom." },
  { id: "static-std-98", framework: "static-html", complexity: "standard", description: "A vanilla JS calculator app. Single HTML file with a full calculator UI (numbers, operators, decimal, clear, equals). CSS grid for button layout. Supports chained operations. History sidebar." },
  { id: "node-s-99", framework: "node", complexity: "simple", description: "An Express.js server-sent events demo. GET /events streams SSE with a counter every 2 seconds. GET / shows an HTML page that connects and displays the stream. GET /api/push POST triggers a custom event. Package.json with express." },
  { id: "rust-s-100", framework: "rust", complexity: "simple", description: "An Axum web server with multiple routes. GET /api/uuid returns a new UUID. GET /api/hash?input=X returns SHA256 hash. GET /api/base64/encode?input=X and /decode. Cargo.toml with axum, tokio, serde, sha2, uuid. Dockerfile multi-stage rust:1.78-slim, expose 3000." },
];
