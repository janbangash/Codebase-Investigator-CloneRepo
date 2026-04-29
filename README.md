# AI Repo Agent

A full-stack application that clones public GitHub repositories with a visual file browser and AI-powered code search. Built with NestJS (backend) and Next.js (frontend).

## Features

- Clone any public GitHub repository via URL input
- Real-time progress tracking with **percentage display**
- **File browser** - View cloned repository files and folders with full navigation
- **File content viewer** - Read file contents with line numbers
- **AI Search Agent** - Search for any code/text across the entire repository
  - Shows matching file path, line number, and content preview
  - Click results to jump to exact line in file viewer
  - Highlighted search terms in results
- Expandable folder tree for nested directory navigation
- Default target folder: `cloned-repos` in the backend directory
- Input validation and error handling

## Project Structure

```
ai-repo-agent/
├── backend/          # NestJS API server
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   └── git/
│   │       ├── git.module.ts
│   │       ├── git.controller.ts
│   │       ├── git.service.ts
│   │       ├── git.gateway.ts
│   │       └── dto/
│   │           └── clone-repo.dto.ts
│   └── cloned-repos/ # Where repos are cloned (created on first run)
├── frontend/         # Next.js application
│   └── app/
│       ├── page.tsx  # Main UI with file browser & AI search
│       └── layout.tsx
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Git installed on your system

### Installation

1. Clone the repository and navigate to the project folder:
```bash
cd ai-repo-agent
```

2. Install backend dependencies:
```bash
cd backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../frontend
npm install
```

### Running the Application

1. Start the backend server:
```bash
cd backend
npm run start:dev
```
The backend will run on http://localhost:4000

2. In a new terminal, start the frontend:
```bash
cd frontend
npm run dev
```
The frontend will run on http://localhost:3000

### Usage

1. Open http://localhost:3000 in your browser
2. Enter a GitHub repository URL (e.g., `https://github.com/owner/repo`)
3. Click "Clone Repository"
4. Watch the progress bar fill with percentage (0% → 100%)
5. When complete, status shows "DONE" (no message clutter)
6. Click on a repository to view its files
7. Navigate folders by clicking on them (they expand inline)
8. Click on files to view contents with line numbers
9. Use the **AI Search** box to search for code:
   - Type any keyword (function name, variable, text)
   - Results show file path, line number, and content preview
   - Click a result to open the file at the matching line
   - Matching text is highlighted in results

## UI Layout

```
+------------------+-------------------+--------------------------+
|  Clone Form      |  File Tree /      |  File Content Viewer     |
|  + Repo List     |  Search Results   |  (with line numbers)     |
|  (Left Sidebar)  |  (Middle Panel)   |  (Right Panel)           |
|                  |  + AI Search Box  |                          |
+------------------+-------------------+--------------------------+
```

- **Left Sidebar (384px)**: Clone form and repository list with progress bars showing percentage
- **Middle Panel (320px)**: Expandable file/folder tree OR search results when using AI search
- **Right Panel (flex)**: File content viewer with line numbers and highlighted search matches

## AI Search Agent

The AI Search feature allows you to search for any code, function, variable, or text within the cloned repository:

1. Type in the search box labeled "AI: Search in repo..."
2. Results appear instantly with debounce (300ms delay)
3. Each result shows:
   - File path (clickable)
   - Line number where the match was found
   - Content preview with highlighted match
4. Click any result to open the file and jump to the exact line

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/api/git/clone` | Start cloning a repository |
| GET    | `/api/git/progress` | Get progress for all clones |
| GET    | `/api/git/progress/:repoName` | Get progress for specific repo |
| GET    | `/api/git/repos` | Get list of cloned repositories |
| GET    | `/api/git/files/:repoName` | List files/folders (query: `path`) |
| GET    | `/api/git/file/:repoName` | Get file content (query: `path`) |
| GET    | `/api/git/search/:repoName` | Search in repo (query: `q`) |

## WebSocket Events

- `clone-progress` - Emitted when clone progress updates

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```env
# Backend
PORT=4000
FRONTEND_URL=http://localhost:3000
CLONE_TARGET_DIR=./cloned-repos
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### Exposing Frontend via ngrok (Share with Client)

To share the UI with a client while keeping the backend local:

1. Start the backend normally (it stays on `http://localhost:4000`)
2. Run the frontend ngrok script:
```powershell
.\start-ngrok-frontend.ps1
```
3. Copy the ngrok URL (e.g., `https://abc123.ngrok-free.dev`)
4. Update backend `.env`:
```env
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://abc123.ngrok-free.dev
```
5. Restart the backend
6. Give the client the frontend ngrok URL

The backend accepts CORS requests from the ngrok URL automatically.

## Tech Stack

**Backend:**
- NestJS 11
- simple-git
- Socket.IO (WebSocket support)
- class-validator (input validation)

**Frontend:**
- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- socket.io-client

## License

ISC
