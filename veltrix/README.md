# Veltrix Panel

Dark-themed TypeScript control panel served by a plain Node.js/Express server.

## Run

```bash
cd veltrix
npm install
npm start        # builds src/app -> public/js, then starts server.js
```

Open http://localhost:3000

## Login

- user: `jayjay`
- pass: `jayjay100!`

Override with env vars `PANEL_USER` / `PANEL_PASS` (and `PORT`).

## Structure

```
veltrix/
  server.js          Express server + login/session/stats API
  package.json
  tsconfig.json
  src/app/           TypeScript frontend (compiled to public/js)
    main.ts          shell, tab routing
    login.ts         login screen
    dashboard.ts     tab 1
    clients.ts       tab 2
    builder.ts       tab 3 (live price builder)
  public/            index.html, css, compiled js
```
