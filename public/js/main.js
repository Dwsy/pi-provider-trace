import { bootstrap } from "./shell/app.js";

bootstrap().catch((err) => {
  console.error("[pi-provider-trace]", err);
  document.body.innerHTML = "<pre style=\"padding:16px;color:#f87171\">" + String(err) + "</pre>";
});
