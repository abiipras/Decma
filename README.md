# Decision Journal

A personal decision journal built with HTML, CSS, vanilla JavaScript, and Vite.

## Current milestone

The app has a responsive interface prototype and a Supabase client configuration. The visible decisions are still sample data stored in browser memory; new decisions and reviews are not yet read from or written to Supabase. Authentication and cross-device sync are not yet connected.

## Run locally

1. Install Node.js if it is not already installed.
2. In this folder, run `npm install`.
3. Run `npm run dev` and open the local address Vite prints.
4. To check a production build, run `npm run build`.

## Main files

- `index.html` is the browser page that loads the app.
- `src/main.js` builds the screens and handles the sample navigation, search, category filter, and new-decision form.
- `src/styles/main.css` controls the visual design and screen-size adjustments.
- `package.json` lists Vite and the commands to run the project.
- `.env.example` documents future public Supabase connection settings. It contains no real credentials.
- `.gitignore` keeps generated files and local environment settings out of Git.
- `supabase/migrations/001_initial_schema.sql` defines the decisions table and its owner-based RLS policies.
- `supabase/migrations/002_decision_review_framework.sql` defines dated, append-only decision reviews and their RLS policies.

## Supabase setup

1. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key. Never put a secret/service-role key in frontend variables.
2. In the Supabase Dashboard, open **SQL Editor** and run `001_initial_schema.sql` first.
3. Run `002_decision_review_framework.sql` second. It references the decisions table created by step 2.

These SQL files are prepared migrations; the app does not execute them automatically.

## Sample data

The sample decisions and summary numbers are examples for the prototype. They are not saved to a database and do not represent real user data.
