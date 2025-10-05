# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.



## Work with local host through phone
Connect device on the same network

Use `npm run dev -- --host`
And find your local computer ip with: `ipconfig getifaddr en0` (mac), `ipconfig` (win/linux)

Then on phone's browser: `http://<your_ip_add>:5173/`


## SET UP WITH NGROK (But dont need this anymore since Hoa already created and local hosting on: https://hypolimnial-stilted-ashley.ngrok-free.dev/)

# Full setup for mac:
brew install ngrok
ngrok config add-authtoken <HOA_AUTH_TOKEN>
npm run dev -- --host
npx ngrok http 5173 (in a new terminal)