import { defineConfig } from "vite";

const backendProxy = {
    target: "http://127.0.0.1:3000",
    changeOrigin: true,
    configure(proxy) {
        proxy.on("error", (error) => {
            console.error(`[vite] Could not reach Express at 127.0.0.1:3000. Start it with "npm run dev:backend". ${error.message}`);
        });
    },
};

const devRouteAliases = new Map([
    ["/", "/react/"],
    ["/login", "/react/login"],
    ["/register", "/react/register"],
    ...["dashboard", "lease", "contracts", "payments", "messages", "profile", "account", "tDashboard", "tLease", "tPayments", "tMessages"]
        .map((path) => [`/${path}`, `/react/${path}`]),
]);

export default defineConfig({
    root: "frontend",
    base: "/react/",
    plugins: [
        {
            name: "bcomplex-dev-route-aliases",
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    if (req.method !== "GET" && req.method !== "HEAD") return next();
                    const pathname = req.url?.split("?")[0];
                    if (!pathname) return next();

                    const route = devRouteAliases.get(pathname);
                    if (!route) return next();

                    res.statusCode = 302;
                    const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
                    res.setHeader("Location", `${route}${query}`);
                    res.end();
                });
            },
        },
    ],
    build: {
        outDir: "../public/react",
        emptyOutDir: true,
    },
    server: {
        proxy: {
            "/api": backendProxy,
            "/newRoom": backendProxy,
            "/newRenter": backendProxy,
            "/renter": backendProxy,
            "/lease/classic": backendProxy,
            "/dashboard/classic": backendProxy,
            "/contracts/classic": backendProxy,
            "/payments/classic": backendProxy,
            "/messages/classic": backendProxy,
            "/profile/classic": backendProxy,
            "/account/classic": backendProxy,
            "/tDashboard/classic": backendProxy,
            "/login": backendProxy,
            "/register": backendProxy,
            "/login/classic": backendProxy,
            "/register/classic": backendProxy,
            "/logout": backendProxy,
        },
    },
});
