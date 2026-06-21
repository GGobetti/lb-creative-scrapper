import express from "express"
import path from "path"
import dotenv from "dotenv"

dotenv.config()

const app = express()
const PORT = process.env.SCRAPER_MONITOR_PORT || 3001

app.use(express.json())

// Serve static files (if any)
app.use(express.static(path.join(__dirname, "../public")))

// Dashboard page
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scraper Monitor</title>
  <script crossorigin src="https://unpkg.com/react@19/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --background: 0 0% 0%;
      --foreground: 0 0% 100%;
      --card: 0 0% 3.6%;
      --card-foreground: 0 0% 100%;
      --primary: 0 0% 100%;
      --primary-foreground: 0 0% 0%;
      --secondary: 0 0% 9.8%;
      --secondary-foreground: 0 0% 100%;
      --muted: 0 0% 14.9%;
      --muted-foreground: 0 0% 63.9%;
      --accent: 0 0% 100%;
      --accent-foreground: 0 0% 0%;
      --destructive: 0 84.2% 60.2%;
      --destructive-foreground: 0 0% 100%;
      --border: 0 0% 14.9%;
      --input: 0 0% 14.9%;
      --ring: 0 0% 100%;
      --radius: 0.5rem;
    }

    * {
      @apply border-border;
    }

    body {
      @apply bg-background text-foreground;
    }
  </style>
</head>
<body>
  <div id="root"></div>

  <script type="module">
    import React from 'https://esm.sh/react@19'
    import ReactDOM from 'https://esm.sh/react-dom@19/client'

    // Dashboard will be rendered here
    ReactDOM.createRoot(document.getElementById('root')).render(
      React.createElement('div', { className: 'min-h-screen bg-background p-4 md:p-6' },
        React.createElement('div', { className: 'max-w-6xl mx-auto' },
          React.createElement('h1', { className: 'text-3xl font-bold text-foreground mb-8' }, 'Scraper Monitor'),
          React.createElement('p', { className: 'text-muted-foreground' }, 'Dashboard do scraper carregando...')
        )
      )
    )
  </script>
</body>
</html>
  `)
})

// API proxy routes (for jobs, banned-images, progress)
app.post("/api/telegram/jobs", async (req, res) => {
  // This would proxy to the actual API
  // For now, return 501 Not Implemented
  res.status(501).json({ error: "API endpoint not yet configured for local server" })
})

app.post("/api/telegram/banned-images", async (req, res) => {
  res.status(501).json({ error: "API endpoint not yet configured for local server" })
})

app.get("/api/telegram/progress", async (req, res) => {
  res.status(501).json({ error: "API endpoint not yet configured for local server" })
})

app.listen(PORT, () => {
  console.log(`\n🖥️  Scraper Monitor rodando em http://localhost:${PORT}\n`)
})
