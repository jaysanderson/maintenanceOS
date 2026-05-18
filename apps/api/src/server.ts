import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);

buildApp()
  .then((app) =>
    app.listen({ port, host: "0.0.0.0" }).then(() => {
      app.log.info(`MaintenanceOS API on http://localhost:${port}`);
      app.log.info(`Swagger docs on http://localhost:${port}/docs`);
    })
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
