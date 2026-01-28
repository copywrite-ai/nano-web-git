
# GitBrowser AI - Local Build Guide

This project is a browser-based Git client powered by `isomorphic-git` and Google Gemini.

## Prerequisites

- [Node.js](https://nodejs.org/) (Version 18 or higher)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)

## Local Setup

1. **Clone the project files** to your local machine.
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure API Key**:
   Create a `.env` file in the root directory:
   ```env
   VITE_API_KEY=your_gemini_api_key_here
   ```
   *(Note: The application uses `process.env.API_KEY`, ensure your build tool is configured to inject this.)*

## Development

Run the development server with hot-module replacement:
```bash
npm run dev
```

## Production Bundling (Packaging)

To create a production-ready bundle (minified HTML, JS, and CSS):

```bash
npm run build
```

The output will be generated in the `dist/` directory, which you can deploy to any static hosting provider (Vercel, GitHub Pages, Netlify).

## Key Technologies
- **isomorphic-git**: Git implementation in JS for the browser.
- **lightning-fs**: In-memory/IndexedDB file system.
- **Vite**: Modern frontend build tool.
- **Tailwind CSS**: Utility-first CSS framework.
- **Gemini AI**: AI-powered code analysis.
